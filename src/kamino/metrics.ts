import type { Address } from "@solana/kit";
import Decimal from "decimal.js";
import type { RpcClients } from "../chain/rpc.ts";
import { withRpcTimeout } from "../chain/rpc.ts";
import type { ReserveWeight, VaultMetricsSnapshot } from "../strategy/types.ts";
import { createVaultClient } from "./vault.ts";

const APY_HISTORY_MAX = 24;
const APY_SPIKE_MIN_HISTORY = 2;
const apyHistoryByVault = new Map<string, number[]>();

/** Reset in-memory APY history (tests). */
export function clearApyHistory(): void {
	apyHistoryByVault.clear();
}

/** Trailing mean of recorded APY samples (excludes the reading about to be recorded). */
export function getTrailingApyAverage(vaultAddress: string): number | null {
	const history = apyHistoryByVault.get(vaultAddress);
	if (!history || history.length < APY_SPIKE_MIN_HISTORY) return null;
	return history.reduce((s, v) => s + v, 0) / history.length;
}

/** True when net APY exceeds `multiple` × trailing average (spec edge case). */
export function isApySpikeAnomaly(
	netApy: number,
	trailingAverage: number | null,
	multiple: number,
): boolean {
	if (trailingAverage === null || trailingAverage <= 0 || multiple <= 0) return false;
	return netApy > multiple * trailingAverage;
}

export function markSnapshotTradingValidity(
	snapshot: VaultMetricsSnapshot,
	options: { apySpikeGuardMultiple: number },
): VaultMetricsSnapshot {
	const trailing = getTrailingApyAverage(snapshot.vaultAddress);
	const apyAnomaly = isApySpikeAnomaly(snapshot.netApy, trailing, options.apySpikeGuardMultiple);
	return {
		...snapshot,
		validForTrading: snapshot.fresh && !apyAnomaly,
	};
}

export function findApySpikeSnapshots(snapshots: VaultMetricsSnapshot[]): VaultMetricsSnapshot[] {
	return snapshots.filter((s) => !s.validForTrading && s.fresh);
}

export function isMetricsFresh(
	snapshot: VaultMetricsSnapshot,
	maxAgeMs: number,
	now: Date = new Date(),
): boolean {
	const ageMs = now.getTime() - snapshot.capturedAt.getTime();
	return ageMs >= 0 && ageMs <= maxAgeMs;
}

export function markSnapshotFreshness(
	snapshot: VaultMetricsSnapshot,
	maxAgeMs: number,
	now: Date = new Date(),
): VaultMetricsSnapshot {
	const fresh = isMetricsFresh(snapshot, maxAgeMs, now);
	return {
		...snapshot,
		fresh,
		validForTrading: fresh ? snapshot.validForTrading : false,
	};
}

/** Trailing coefficient-of-variation of recorded APY samples (0 = stable). */
export function computeYieldVolatility(vaultAddress: string, netApy: number): number {
	const history = apyHistoryByVault.get(vaultAddress) ?? [];
	history.push(netApy);
	if (history.length > APY_HISTORY_MAX) history.shift();
	apyHistoryByVault.set(vaultAddress, history);

	if (history.length < 2) return 0;

	const mean = history.reduce((s, v) => s + v, 0) / history.length;
	if (mean <= 0) return 0;

	const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
	const stddev = Math.sqrt(variance);
	return stddev / mean;
}

export function reserveWeightsFromAllocations(
	allocations: Map<Address, { ctokenAllocation: { toString(): string } }>,
): ReserveWeight[] {
	let total = new Decimal(0);
	const amounts = new Map<string, Decimal>();

	for (const [reserve, overview] of allocations) {
		const amt = new Decimal(overview.ctokenAllocation.toString());
		if (amt.lte(0)) continue;
		amounts.set(reserve, amt);
		total = total.add(amt);
	}

	if (total.lte(0)) return [];

	return [...amounts.entries()].map(([reserveAddress, amt]) => ({
		reserveAddress,
		weightPct: amt.div(total).mul(100).toNumber(),
	}));
}

export function utilizationFromHoldings(invested: Decimal, totalAum: Decimal): number | null {
	if (totalAum.lte(0)) return null;
	return invested.div(totalAum).toNumber();
}

export function normalizeVaultMetricsSnapshot(
	raw: Omit<VaultMetricsSnapshot, "fresh" | "validForTrading">,
	maxAgeMs: number,
	now: Date = new Date(),
): VaultMetricsSnapshot {
	return markSnapshotFreshness({ ...raw, fresh: false, validForTrading: true }, maxAgeMs, now);
}

export async function fetchVaultMetricsSnapshot(
	clients: RpcClients,
	vaultAddress: string,
	options?: { now?: Date; maxAgeMs?: number; apySpikeGuardMultiple?: number },
): Promise<VaultMetricsSnapshot> {
	const now = options?.now ?? new Date();
	const vault = createVaultClient(clients.rpc, vaultAddress);

	const { apys, holdings, allocations } = await withRpcTimeout(clients, async () => {
		const [apys, holdings, allocations] = await Promise.all([
			vault.getAPYs(),
			vault.getVaultHoldings(),
			vault.getVaultAllocations(),
		]);
		return { apys, holdings, allocations };
	});

	const netApy = apys.actualAPY.netAPY.toNumber();
	const tvlUsd = holdings.totalAUMIncludingFees.toNumber();
	const utilization = utilizationFromHoldings(holdings.invested, holdings.totalAUMIncludingFees);
	const reserveWeights = reserveWeightsFromAllocations(allocations);
	const trailingApy = getTrailingApyAverage(vaultAddress);
	const apySpike =
		options?.apySpikeGuardMultiple !== undefined &&
		isApySpikeAnomaly(netApy, trailingApy, options.apySpikeGuardMultiple);
	const yieldVolatility = computeYieldVolatility(vaultAddress, netApy);

	let result: VaultMetricsSnapshot = {
		vaultAddress,
		capturedAt: now,
		netApy,
		tvlUsd,
		utilization,
		reserveWeights,
		yieldVolatility,
		source: "chain",
		fresh: true,
		validForTrading: !apySpike,
	};

	if (options?.maxAgeMs !== undefined) {
		result = markSnapshotFreshness(result, options.maxAgeMs, now);
	}
	return result;
}

export async function fetchVaultMetricsSnapshots(
	clients: RpcClients,
	vaultAddresses: string[],
	options?: { now?: Date; maxAgeMs?: number; apySpikeGuardMultiple?: number },
): Promise<VaultMetricsSnapshot[]> {
	return Promise.all(
		vaultAddresses.map((vaultAddress) => fetchVaultMetricsSnapshot(clients, vaultAddress, options)),
	);
}

/** @internal test helper — build snapshot without RPC */
export function buildMetricsSnapshot(
	input: Partial<VaultMetricsSnapshot> & Pick<VaultMetricsSnapshot, "vaultAddress">,
): VaultMetricsSnapshot {
	const capturedAt = input.capturedAt ?? new Date();
	return {
		capturedAt,
		netApy: input.netApy ?? 0,
		tvlUsd: input.tvlUsd ?? 0,
		utilization: input.utilization ?? null,
		reserveWeights: input.reserveWeights ?? [],
		yieldVolatility: input.yieldVolatility ?? 0,
		source: input.source ?? "api",
		fresh: input.fresh ?? true,
		validForTrading: input.validForTrading ?? true,
		vaultAddress: input.vaultAddress,
	};
}
