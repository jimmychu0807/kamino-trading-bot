import type { Address } from "@solana/kit";
import Decimal from "decimal.js";
import type { RpcClients } from "../chain/rpc.ts";
import { withRpcTimeout } from "../chain/rpc.ts";
import type { ReserveWeight, VaultMetricsSnapshot } from "../strategy/types.ts";
import { createVaultClient } from "./vault.ts";

const APY_HISTORY_MAX = 24;
const apyHistoryByVault = new Map<string, number[]>();

/** Reset in-memory APY history (tests). */
export function clearApyHistory(): void {
	apyHistoryByVault.clear();
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
	return {
		...snapshot,
		fresh: isMetricsFresh(snapshot, maxAgeMs, now),
	};
}

/** Trailing coefficient-of-variation of recorded APY samples (0 = stable). */
export function computeYieldVolatility(
	vaultAddress: string,
	netApy: number,
): number {
	const history = apyHistoryByVault.get(vaultAddress) ?? [];
	history.push(netApy);
	if (history.length > APY_HISTORY_MAX) history.shift();
	apyHistoryByVault.set(vaultAddress, history);

	if (history.length < 2) return 0;

	const mean = history.reduce((s, v) => s + v, 0) / history.length;
	if (mean <= 0) return 0;

	const variance =
		history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
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

export function utilizationFromHoldings(
	invested: Decimal,
	totalAum: Decimal,
): number | null {
	if (totalAum.lte(0)) return null;
	return invested.div(totalAum).toNumber();
}

export function normalizeVaultMetricsSnapshot(
	raw: Omit<VaultMetricsSnapshot, "fresh">,
	maxAgeMs: number,
	now: Date = new Date(),
): VaultMetricsSnapshot {
	return markSnapshotFreshness({ ...raw, fresh: false }, maxAgeMs, now);
}

export async function fetchVaultMetricsSnapshot(
	clients: RpcClients,
	vaultAddress: string,
	options?: { now?: Date; maxAgeMs?: number },
): Promise<VaultMetricsSnapshot> {
	const now = options?.now ?? new Date();
	const vault = createVaultClient(clients.rpc, vaultAddress);

	const { apys, holdings, allocations } = await withRpcTimeout(
		clients,
		async () => {
			const [apys, holdings, allocations] = await Promise.all([
				vault.getAPYs(),
				vault.getVaultHoldings(),
				vault.getVaultAllocations(),
			]);
			return { apys, holdings, allocations };
		},
	);

	const netApy = apys.actualAPY.netAPY.toNumber();
	const tvlUsd = holdings.totalAUMIncludingFees.toNumber();
	const utilization = utilizationFromHoldings(
		holdings.invested,
		holdings.totalAUMIncludingFees,
	);
	const reserveWeights = reserveWeightsFromAllocations(allocations);
	const yieldVolatility = computeYieldVolatility(vaultAddress, netApy);

	const snapshot: VaultMetricsSnapshot = {
		vaultAddress,
		capturedAt: now,
		netApy,
		tvlUsd,
		utilization,
		reserveWeights,
		yieldVolatility,
		source: "chain",
		fresh: true,
	};

	if (options?.maxAgeMs !== undefined) {
		return markSnapshotFreshness(snapshot, options.maxAgeMs, now);
	}

	return snapshot;
}

export async function fetchVaultMetricsSnapshots(
	clients: RpcClients,
	vaultAddresses: string[],
	options?: { now?: Date; maxAgeMs?: number },
): Promise<VaultMetricsSnapshot[]> {
	return Promise.all(
		vaultAddresses.map((vaultAddress) =>
			fetchVaultMetricsSnapshot(clients, vaultAddress, options),
		),
	);
}

/** @internal test helper — build snapshot without RPC */
export function buildMetricsSnapshot(
	input: Partial<VaultMetricsSnapshot> &
		Pick<VaultMetricsSnapshot, "vaultAddress">,
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
		vaultAddress: input.vaultAddress,
	};
}
