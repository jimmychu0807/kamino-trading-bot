import type { TransactionSigner } from "@solana/kit";
import type { RpcClients } from "../chain/rpc.ts";
import type { OperatorConfig } from "../config/schema.ts";
import type { AppDatabase } from "../db/client.ts";
import { fetchVaultMetricsSnapshots } from "../kamino/metrics.ts";
import { computeMaxDriftPct, reconcilePositions } from "../kamino/reconcile.ts";
import { computeTargetsFromSnapshots } from "../strategy/allocate.ts";
import { applyMaxAllocationCap } from "../strategy/deployable.ts";
import { isCycleInFlight, withCycleMutex } from "./mutex.ts";
import { type CycleContext, type CycleResult, runCycle } from "./runner.ts";

export type DriftTriggerContext = {
	config: OperatorConfig;
	clients: RpcClients;
	signer: TransactionSigner;
	db: AppDatabase;
};

export type DriftTriggerHandle = {
	stop: () => void;
};

export type DriftTriggerDeps = {
	reconcile?: CycleContext["reconcile"];
	fetchMetrics?: typeof fetchVaultMetricsSnapshots;
	runCycleFn?: (ctx: CycleContext) => Promise<CycleResult>;
};

/** Single drift poll — returns cycle result when drift exceeds band, else null. */
export async function pollDriftOnce(
	ctx: DriftTriggerContext,
	deps: DriftTriggerDeps = {},
): Promise<CycleResult | null> {
	if (isCycleInFlight()) {
		console.log(JSON.stringify({ skipped: true, reason: "cycle_in_flight", source: "drift" }));
		return null;
	}

	const reconcile = deps.reconcile ?? reconcilePositions;
	const fetchMetrics = deps.fetchMetrics ?? fetchVaultMetricsSnapshots;
	const runCycleFn = deps.runCycleFn ?? runCycle;

	const vaultAddresses = ctx.config.vaults
		.filter((vault) => vault.enabled !== false)
		.map((vault) => vault.address);

	return withCycleMutex(async () => {
		const now = new Date();
		const position = applyMaxAllocationCap(
			await reconcile({
				clients: ctx.clients,
				walletAddress: ctx.signer.address,
				vaultAddresses,
			}),
			ctx.config.maxAllocationBase,
		);

		const snapshots = await fetchMetrics(ctx.clients, vaultAddresses, {
			now,
			maxAgeMs: ctx.config.metricsMaxAgeMs,
		});

		if (snapshots.some((snapshot) => !snapshot.fresh)) {
			return null;
		}

		const { targets } = computeTargetsFromSnapshots(
			snapshots,
			ctx.config.policy,
			ctx.config.vaults,
			position.totalDeployable,
		);

		const maxDrift = computeMaxDriftPct(position, targets);
		if (maxDrift <= ctx.config.policy.driftBandPct) {
			return null;
		}

		const abort = AbortSignal.timeout(ctx.config.cycleTimeoutMs);
		return runCycleFn({
			config: ctx.config,
			clients: ctx.clients,
			signer: ctx.signer,
			db: ctx.db,
			now,
			abortSignal: abort,
			reconcile,
			fetchMetrics,
		});
	});
}

/**
 * FR-013: optional background poll — invoke full cycle when drift exceeds band.
 * No-op when `driftTriggerEnabled` is false.
 */
export function startDriftTrigger(
	ctx: DriftTriggerContext,
	deps: DriftTriggerDeps = {},
): DriftTriggerHandle {
	if (!ctx.config.driftTriggerEnabled) {
		return { stop: () => {} };
	}

	const poll = async (): Promise<void> => {
		const result = await pollDriftOnce(ctx, deps);
		if (result === null) {
			return;
		}

		console.log(
			JSON.stringify({
				source: "drift_trigger",
				cycleId: result.cycleId,
				status: result.status,
			}),
		);
	};

	const timer = setInterval(() => {
		void poll();
	}, ctx.config.driftPollIntervalMs);

	return {
		stop: () => clearInterval(timer),
	};
}
