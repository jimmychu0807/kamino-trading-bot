import type { TransactionSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import type { RpcClients } from "../chain/rpc.ts";
import type { OperatorConfig } from "../config/schema.ts";
import type { AppDatabase } from "../db/client.ts";
import {
	type DecisionLogInput,
	finishCycle,
	getLastCompletedRebalanceAt,
	insertCycle,
	writeDecisionLog,
	writeMetricSnapshots,
	writeRebalanceActions,
} from "../db/decision.ts";
import { writePolicySnapshot } from "../db/policy.ts";
import { decisionLogs } from "../db/schema.ts";
import { fetchVaultMetricsSnapshots } from "../kamino/metrics.ts";
import {
	type ReconcileContext,
	reconcilePositions,
	type WalletPosition,
} from "../kamino/reconcile.ts";
import { computeTargetsFromSnapshots } from "../strategy/allocate.ts";
import { estimateExpectedImprovementBps } from "../strategy/improvement.ts";
import type { TargetAllocation } from "../strategy/types.ts";
import {
	type CurrentAllocation,
	type ShouldRebalanceResult,
	shouldRebalance,
} from "../strategy/warrant.ts";
import {
	type ExecutedRebalanceAction,
	executeRebalanceActions,
	planRebalanceActions,
	type RebalanceAction,
} from "./execute.ts";
import { type ActiveHold, getActiveExecutionHold } from "./hold.ts";

export type CycleStatus =
	| "completed"
	| "skipped"
	| "preview"
	| "dependency_hold"
	| "execution_hold"
	| "timeout"
	| "partial";

export type DecisionLog = DecisionLogInput & {
	cycleId: string;
};

export type CycleResult = {
	cycleId: string;
	status: CycleStatus;
	decisionLog: DecisionLog;
	actions: RebalanceAction[];
	hold: ActiveHold | null;
};

export type CycleContext = {
	config: OperatorConfig;
	clients: RpcClients;
	signer: TransactionSigner;
	db: AppDatabase;
	now: Date;
	abortSignal?: AbortSignal;
	reconcile?: (ctx: ReconcileContext) => Promise<WalletPosition>;
	fetchMetrics?: typeof fetchVaultMetricsSnapshots;
	executeActions?: typeof executeRebalanceActions;
};

function assertNotAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException("Cycle aborted", "AbortError");
	}
}

function currentAllocationsFromPosition(position: WalletPosition): CurrentAllocation[] {
	if (position.totalDeployable <= 0n) {
		return position.vaultShares.map((share) => ({
			vaultAddress: share.vaultAddress,
			currentPct: 0,
		}));
	}
	const total = Number(position.totalDeployable);
	return position.vaultShares.map((share) => ({
		vaultAddress: share.vaultAddress,
		currentPct: (Number(share.valueBase) / total) * 100,
	}));
}

function buildRationale(parts: string[]): string {
	return parts.filter(Boolean).join("; ");
}

function serializePosition(position: WalletPosition) {
	return {
		...position,
		tokenBalance: position.tokenBalance.toString(),
		vaultShares: position.vaultShares.map((share) => ({
			...share,
			shares: share.shares.toString(),
			valueBase: share.valueBase.toString(),
		})),
		totalDeployable: position.totalDeployable.toString(),
	};
}

function serializeTargets(targets: TargetAllocation[]) {
	return targets.map((target) => ({
		...target,
		targetAmount: target.targetAmount.toString(),
	}));
}

function serializeActions(actions: RebalanceAction[] | ExecutedRebalanceAction[]) {
	return actions.map((action) => ({
		...action,
		amountBase: action.amountBase.toString(),
	}));
}

async function persistDecision(db: AppDatabase, log: DecisionLog): Promise<void> {
	await writeDecisionLog(db, log);
}

export async function runCycle(ctx: CycleContext): Promise<CycleResult> {
	const { config, clients, signer, db, now } = ctx;
	const cycleId = crypto.randomUUID();
	const previewMode = config.previewMode;
	const vaultAddresses = config.vaults
		.filter((vault) => vault.enabled !== false)
		.map((vault) => vault.address);

	const reconcile = ctx.reconcile ?? reconcilePositions;
	const fetchMetrics = ctx.fetchMetrics ?? fetchVaultMetricsSnapshots;
	const executeActions = ctx.executeActions ?? executeRebalanceActions;

	const executionHold = await getActiveExecutionHold(db);
	if (executionHold) {
		const decisionLog: DecisionLog = {
			cycleId,
			inputs: { hold: executionHold },
			scores: [],
			targets: [],
			actions: [],
			outcome: "execution_hold",
			rationale: buildRationale(["Active execution hold blocks trading", executionHold.reason]),
		};

		await insertCycle(db, { cycleId, startedAt: now, previewMode });
		await persistDecision(db, decisionLog);
		await finishCycle(db, {
			cycleId,
			status: "execution_hold",
			endedAt: now,
		});

		return {
			cycleId,
			status: "execution_hold",
			decisionLog,
			actions: [],
			hold: executionHold,
		};
	}

	await insertCycle(db, { cycleId, startedAt: now, previewMode });

	try {
		assertNotAborted(ctx.abortSignal);

		const position = await reconcile({
			clients,
			walletAddress: signer.address,
			vaultAddresses,
		});

		assertNotAborted(ctx.abortSignal);

		const snapshots = await fetchMetrics(clients, vaultAddresses, {
			now,
			maxAgeMs: config.metricsMaxAgeMs,
		});

		await writeMetricSnapshots(db, {
			cycleId,
			snapshots: snapshots.map((snapshot) => ({
				vaultAddress: snapshot.vaultAddress,
				capturedAt: snapshot.capturedAt,
				payload: snapshot,
			})),
		});

		const staleVaults = snapshots.filter((snapshot) => !snapshot.fresh);
		if (staleVaults.length > 0) {
			const { policyHash } = await writePolicySnapshot(db, {
				cycleId,
				policy: config.policy,
				now,
			});

			const decisionLog: DecisionLog = {
				cycleId,
				inputs: {
					position: serializePosition(position),
					staleVaults: staleVaults.map((s) => s.vaultAddress),
					policyHash,
				},
				scores: [],
				targets: [],
				actions: [],
				outcome: "dependency_hold",
				rationale: buildRationale([
					"Stale metrics — dependency hold",
					`vaults: ${staleVaults.map((s) => s.vaultAddress).join(", ")}`,
				]),
			};

			await persistDecision(db, decisionLog);
			await finishCycle(db, {
				cycleId,
				status: "dependency_hold",
				endedAt: now,
			});

			return {
				cycleId,
				status: "dependency_hold",
				decisionLog,
				actions: [],
				hold: null,
			};
		}

		const { scores, targets } = computeTargetsFromSnapshots(
			snapshots,
			config.policy,
			config.vaults,
			position.totalDeployable,
		);

		const { policyHash } = await writePolicySnapshot(db, {
			cycleId,
			policy: config.policy,
			now,
		});

		const currentAllocations = currentAllocationsFromPosition(position);
		const expectedImprovementBps = estimateExpectedImprovementBps(
			snapshots,
			currentAllocations,
			targets,
		);
		const lastRebalanceAt = await getLastCompletedRebalanceAt(db);

		const warrant: ShouldRebalanceResult = shouldRebalance({
			policy: config.policy,
			targets,
			currentAllocations,
			totalDeployableBase: position.totalDeployable,
			expectedImprovementBps,
			now,
			lastRebalanceAt,
			scores,
		});

		const planned = planRebalanceActions({
			position,
			targets,
			warrant,
		});

		let status: CycleStatus;
		let executed: ExecutedRebalanceAction[] = [];
		let rationale: string;

		if (!warrant.shouldRebalance) {
			status = "skipped";
			rationale = buildRationale([
				`Skip: ${warrant.reason}`,
				`maxDrift=${warrant.maxDriftPct.toFixed(2)}%`,
			]);
		} else if (previewMode) {
			status = "preview";
			rationale = buildRationale([
				"Preview mode — planned legs only",
				`reason=${warrant.reason}`,
				`legs=${planned.length}`,
			]);
		} else {
			assertNotAborted(ctx.abortSignal);
			const execution = await executeActions({
				clients,
				signer,
				actions: planned,
			});
			executed = execution.actions;
			status = execution.status === "partial" ? "partial" : "completed";
			rationale = buildRationale([
				`Live execution ${execution.status}`,
				`confirmed=${executed.filter((a) => a.status === "confirmed").length}`,
				`failed=${executed.filter((a) => a.status === "failed").length}`,
			]);

			await writeRebalanceActions(
				db,
				executed.map((action) => ({
					id: crypto.randomUUID(),
					cycleId,
					vaultAddress: action.vaultAddress,
					kind: action.kind,
					phase: action.phase,
					plannedAmount: action.amountBase.toString(),
					txSignature: action.signature ?? null,
					status: action.status,
					attempts: action.attempts,
					error: action.error ?? null,
				})),
			);
		}

		const actionsForLog =
			executed.length > 0 ? serializeActions(executed) : serializeActions(planned);

		const decisionLog: DecisionLog = {
			cycleId,
			inputs: {
				position: serializePosition(position),
				policyHash,
				previewMode,
				warrant,
				expectedImprovementBps,
			},
			scores,
			targets: serializeTargets(targets),
			actions: actionsForLog,
			outcome: status,
			rationale,
		};

		await persistDecision(db, decisionLog);
		await finishCycle(db, { cycleId, status, endedAt: now });

		return {
			cycleId,
			status,
			decisionLog,
			actions: planned,
			hold: null,
		};
	} catch (error) {
		const isAbort = error instanceof DOMException && error.name === "AbortError";
		const status: CycleStatus = isAbort ? "timeout" : "partial";
		const rationale = isAbort
			? "Cycle timeout — aborted before completion"
			: `Cycle error: ${error instanceof Error ? error.message : String(error)}`;

		const decisionLog: DecisionLog = {
			cycleId,
			inputs: { previewMode },
			scores: [],
			targets: [],
			actions: [],
			outcome: status,
			rationale,
		};

		await persistDecision(db, decisionLog);
		await finishCycle(db, { cycleId, status, endedAt: now });

		return {
			cycleId,
			status,
			decisionLog,
			actions: [],
			hold: null,
		};
	}
}

/** Load persisted decision log for a cycle (tests / CLI). */
export async function loadDecisionLog(
	db: AppDatabase,
	cycleId: string,
): Promise<DecisionLog | null> {
	const rows = await db
		.select()
		.from(decisionLogs)
		.where(eq(decisionLogs.cycleId, cycleId))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		cycleId: row.cycleId,
		inputs: JSON.parse(row.inputsJson),
		scores: JSON.parse(row.scoresJson),
		targets: JSON.parse(row.targetsJson),
		actions: JSON.parse(row.actionsJson),
		outcome: row.outcome,
		rationale: row.rationale,
	};
}
