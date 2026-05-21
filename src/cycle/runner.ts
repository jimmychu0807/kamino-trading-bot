import type { TransactionSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { alertFromEnv } from "../alerts/emit.ts";
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
import { fetchVaultMetricsSnapshots, findApySpikeSnapshots } from "../kamino/metrics.ts";
import {
	type ReconcileContext,
	reconcilePositions,
	type WalletPosition,
} from "../kamino/reconcile.ts";
import { computeTargetsFromSnapshots } from "../strategy/allocate.ts";
import { applyMaxAllocationCap } from "../strategy/deployable.ts";
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
import {
	type ActiveHold,
	acknowledgeExecutionHold,
	clearDependencyHold,
	enterDependencyHold,
	enterExecutionHold,
	getActiveDependencyHold,
	getActiveExecutionHold,
	getLatestConsecutiveFailureCount,
	nextConsecutiveFailureCount,
} from "./hold.ts";

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
	alertEnv?: Record<string, string | undefined>;
	reconcile?: (ctx: ReconcileContext) => Promise<WalletPosition>;
	fetchMetrics?: typeof fetchVaultMetricsSnapshots;
	executeActions?: typeof executeRebalanceActions;
};

function assertNotAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException("Cycle aborted", "AbortError");
	}
}

function isRpcTimeoutError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.message.includes("timed out") || error.message.includes("RPC call timed out");
	}
	return false;
}

function dependencyReasonFromError(error: unknown): "rpc_timeout" | "vault_unavailable" {
	return isRpcTimeoutError(error) ? "rpc_timeout" : "vault_unavailable";
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
		totalOnChain: position.totalOnChain.toString(),
		walletBalanceCounted: position.walletBalanceCounted.toString(),
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

async function finishCycleWithFailureTracking(
	ctx: CycleContext,
	params: {
		cycleId: string;
		status: CycleStatus;
		endedAt: Date;
		hadFailedTx: boolean;
	},
): Promise<ActiveHold | null> {
	const previousCount = await getLatestConsecutiveFailureCount(ctx.db);
	const consecutiveFailureCount = nextConsecutiveFailureCount(previousCount, params.hadFailedTx);

	await finishCycle(ctx.db, {
		cycleId: params.cycleId,
		status: params.status,
		endedAt: params.endedAt,
		consecutiveFailureCount,
	});

	if (params.hadFailedTx && consecutiveFailureCount >= ctx.config.consecutiveFailureThreshold) {
		const hold = await enterExecutionHold(ctx.db, {
			reason: "tx_failures",
			now: params.endedAt,
		});
		alertFromEnv(
			"execution_hold_entered",
			{
				cycleId: params.cycleId,
				message: `Execution hold entered after ${consecutiveFailureCount} consecutive cycles with failed transactions`,
				details: { consecutiveFailureCount, threshold: ctx.config.consecutiveFailureThreshold },
				now: params.endedAt,
			},
			ctx.alertEnv,
		);
		return hold;
	}

	return null;
}

async function returnDependencyHold(
	ctx: CycleContext,
	params: {
		cycleId: string;
		now: Date;
		position?: WalletPosition;
		reason: string;
		alertEvent: "metrics_stale" | "rpc_timeout" | "vault_unavailable";
		message: string;
		details?: Record<string, unknown>;
	},
): Promise<CycleResult> {
	const hadDependencyHold = await getActiveDependencyHold(ctx.db);
	const hold = await enterDependencyHold(ctx.db, {
		reason: params.reason,
		now: params.now,
	});

	if (!hadDependencyHold) {
		alertFromEnv(
			"dependency_hold_entered",
			{
				cycleId: params.cycleId,
				message: `Dependency hold entered: ${params.reason}`,
				details: params.details,
				now: params.now,
			},
			ctx.alertEnv,
		);
	}

	alertFromEnv(
		params.alertEvent,
		{
			cycleId: params.cycleId,
			message: params.message,
			details: params.details,
			now: params.now,
		},
		ctx.alertEnv,
	);

	const decisionLog: DecisionLog = {
		cycleId: params.cycleId,
		inputs: {
			...(params.position ? { position: serializePosition(params.position) } : {}),
			hold,
			...params.details,
		},
		scores: [],
		targets: [],
		actions: [],
		outcome: "dependency_hold",
		rationale: buildRationale(["Dependency hold", params.message]),
	};

	await persistDecision(ctx.db, decisionLog);
	await finishCycleWithFailureTracking(ctx, {
		cycleId: params.cycleId,
		status: "dependency_hold",
		endedAt: params.now,
		hadFailedTx: false,
	});

	return {
		cycleId: params.cycleId,
		status: "dependency_hold",
		decisionLog,
		actions: [],
		hold,
	};
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
		await finishCycleWithFailureTracking(ctx, {
			cycleId,
			status: "execution_hold",
			endedAt: now,
			hadFailedTx: false,
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

		let position: WalletPosition;
		try {
			position = applyMaxAllocationCap(
				await reconcile({
					clients,
					walletAddress: signer.address,
					vaultAddresses,
				}),
				config.maxAllocationBase,
			);
		} catch (error) {
			const reason = dependencyReasonFromError(error);
			return returnDependencyHold(ctx, {
				cycleId,
				now,
				reason,
				alertEvent: reason,
				message: error instanceof Error ? error.message : String(error),
				details: { phase: "reconcile" },
			});
		}

		assertNotAborted(ctx.abortSignal);

		let snapshots: Awaited<ReturnType<typeof fetchMetrics>>;
		try {
			snapshots = await fetchMetrics(clients, vaultAddresses, {
				now,
				maxAgeMs: config.metricsMaxAgeMs,
				apySpikeGuardMultiple: config.apySpikeGuardMultiple,
			});
		} catch (error) {
			const reason = dependencyReasonFromError(error);
			return returnDependencyHold(ctx, {
				cycleId,
				now,
				position,
				reason,
				alertEvent: reason,
				message: error instanceof Error ? error.message : String(error),
				details: { phase: "metrics" },
			});
		}

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
			return returnDependencyHold(ctx, {
				cycleId,
				now,
				position,
				reason: "stale_metrics",
				alertEvent: "metrics_stale",
				message: `Stale metrics for vaults: ${staleVaults.map((s) => s.vaultAddress).join(", ")}`,
				details: { staleVaults: staleVaults.map((s) => s.vaultAddress) },
			});
		}

		const apySpikeVaults = findApySpikeSnapshots(snapshots);
		if (apySpikeVaults.length > 0) {
			return returnDependencyHold(ctx, {
				cycleId,
				now,
				position,
				reason: "apy_spike",
				alertEvent: "metrics_stale",
				message: `Anomalous APY spike for vaults: ${apySpikeVaults.map((s) => s.vaultAddress).join(", ")}`,
				details: {
					apySpikeVaults: apySpikeVaults.map((s) => ({
						vaultAddress: s.vaultAddress,
						netApy: s.netApy,
						guardMultiple: config.apySpikeGuardMultiple,
					})),
				},
			});
		}

		if (await clearDependencyHold(db)) {
			alertFromEnv(
				"dependency_hold_cleared",
				{
					cycleId,
					message: "Dependency checks passed — resuming normal evaluation",
					now,
				},
				ctx.alertEnv,
			);
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
		let hadFailedTx = false;

		if (!warrant.shouldRebalance) {
			status = "skipped";
			rationale = buildRationale([
				`Skip: ${warrant.reason}`,
				`maxDrift=${warrant.maxDriftPct.toFixed(2)}%`,
			]);
			alertFromEnv(
				"rebalance_skipped",
				{
					cycleId,
					message: rationale,
					details: { reason: warrant.reason, maxDriftPct: warrant.maxDriftPct },
					now,
				},
				ctx.alertEnv,
			);
		} else if (previewMode) {
			status = "preview";
			rationale = buildRationale([
				"Preview mode — planned legs only",
				`reason=${warrant.reason}`,
				`legs=${planned.length}`,
			]);
		} else {
			if (warrant.criticalRiskExit) {
				alertFromEnv(
					"critical_risk_exit",
					{
						cycleId,
						message: "Critical risk exit override — rebalancing despite cooldown/guardrails",
						details: { reason: warrant.reason },
						now,
					},
					ctx.alertEnv,
				);
			}

			assertNotAborted(ctx.abortSignal);
			const execution = await executeActions({
				clients,
				signer,
				actions: planned,
			});
			executed = execution.actions;
			status = execution.status === "partial" ? "partial" : "completed";
			hadFailedTx = executed.some((action) => action.status === "failed");

			rationale = buildRationale([
				`Live execution ${execution.status}`,
				`confirmed=${executed.filter((a) => a.status === "confirmed").length}`,
				`failed=${executed.filter((a) => a.status === "failed").length}`,
			]);

			if (hadFailedTx) {
				const failed = executed.filter((a) => a.status === "failed");
				alertFromEnv(
					"tx_leg_failed",
					{
						cycleId,
						message: `Transaction leg failed: ${failed.map((a) => a.vaultAddress).join(", ")}`,
						details: {
							failedLegs: failed.map((a) => ({
								vaultAddress: a.vaultAddress,
								kind: a.kind,
								error: a.error,
							})),
						},
						now,
					},
					ctx.alertEnv,
				);
			} else {
				alertFromEnv(
					"rebalance_executed",
					{
						cycleId,
						message: rationale,
						details: { legs: executed.length },
						now,
					},
					ctx.alertEnv,
				);
			}

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
		const hold = await finishCycleWithFailureTracking(ctx, {
			cycleId,
			status,
			endedAt: now,
			hadFailedTx,
		});

		return {
			cycleId,
			status,
			decisionLog,
			actions: planned,
			hold,
		};
	} catch (error) {
		const isAbort = error instanceof DOMException && error.name === "AbortError";
		const status: CycleStatus = isAbort ? "timeout" : "partial";
		const rationale = isAbort
			? "Cycle timeout — aborted before completion"
			: `Cycle error: ${error instanceof Error ? error.message : String(error)}`;

		if (isAbort) {
			alertFromEnv(
				"cycle_timeout",
				{
					cycleId,
					message: rationale,
					details: { cycleTimeoutMs: config.cycleTimeoutMs },
					now,
				},
				ctx.alertEnv,
			);
		}

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
		await finishCycleWithFailureTracking(ctx, {
			cycleId,
			status,
			endedAt: now,
			hadFailedTx: false,
		});

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

export { acknowledgeExecutionHold };
