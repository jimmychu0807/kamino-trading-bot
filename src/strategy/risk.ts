import type { RebalancePolicy } from "../config/schema.ts";
import type { ReserveWeight, RiskScore, VaultMetricsSnapshot } from "./types.ts";

const DEFAULT_REFERENCE_TVL_USD = 10_000_000;
const MAX_VOLATILITY = 0.5;

/** Higher TVL → higher score (0–1). Uses max TVL across vaults when provided. */
export function computeLiquidityScore(
	tvlUsd: number,
	referenceTvlUsd: number = DEFAULT_REFERENCE_TVL_USD,
): number {
	if (tvlUsd <= 0) return 0;
	const ratio = tvlUsd / Math.max(referenceTvlUsd, 1);
	return clamp01(Math.log10(1 + ratio) / Math.log10(1 + 10));
}

/** Lower utilization → higher score (0–1). */
export function computeUtilizationScore(utilization: number | null): number {
	if (utilization === null || Number.isNaN(utilization)) return 0.5;
	return clamp01(1 - utilization);
}

/** Lower single-reserve concentration → higher score (0–1). */
export function computeConcentrationScore(reserveWeights: ReserveWeight[]): number {
	if (reserveWeights.length === 0) return 0.5;
	const maxWeight = Math.max(...reserveWeights.map((r) => r.weightPct));
	return clamp01(1 - maxWeight / 100);
}

/**
 * FR-017: penalize reserves shared heavily across multiple vaults.
 * Returns 0–1 penalty (higher = worse concentration).
 */
export function computeCrossVaultReservePenalty(
	snapshot: VaultMetricsSnapshot,
	allSnapshots: VaultMetricsSnapshot[],
): number {
	if (allSnapshots.length <= 1) return 0;

	const combinedByReserve = new Map<string, number>();
	for (const s of allSnapshots) {
		for (const { reserveAddress, weightPct } of s.reserveWeights) {
			combinedByReserve.set(
				reserveAddress,
				(combinedByReserve.get(reserveAddress) ?? 0) + weightPct,
			);
		}
	}

	let maxOverlap = 0;
	for (const { reserveAddress, weightPct } of snapshot.reserveWeights) {
		const combined = combinedByReserve.get(reserveAddress) ?? weightPct;
		if (combined > maxOverlap) maxOverlap = combined;
	}

	return clamp01(maxOverlap / 100);
}

export function computeRiskScore(
	snapshot: VaultMetricsSnapshot,
	policy: RebalancePolicy,
	options?: {
		allSnapshots?: VaultMetricsSnapshot[];
		referenceTvlUsd?: number;
	},
): RiskScore {
	const allSnapshots = options?.allSnapshots ?? [snapshot];
	const referenceTvlUsd =
		options?.referenceTvlUsd ??
		Math.max(...allSnapshots.map((s) => s.tvlUsd), DEFAULT_REFERENCE_TVL_USD);

	const liquidityScore = computeLiquidityScore(snapshot.tvlUsd, referenceTvlUsd);
	const utilizationScore = computeUtilizationScore(snapshot.utilization);
	const baseConcentration = computeConcentrationScore(snapshot.reserveWeights);
	const crossPenalty = computeCrossVaultReservePenalty(snapshot, allSnapshots);
	const concentrationScore = clamp01(baseConcentration * (1 - crossPenalty * 0.5));
	const volatilityScore = clamp01(1 - Math.min(snapshot.yieldVolatility / MAX_VOLATILITY, 1));

	const w = policy.riskWeights;
	const weightSum = w.liquidity + w.utilization + w.concentration + w.volatility;
	const composite =
		weightSum > 0
			? clamp01(
					(liquidityScore * w.liquidity +
						utilizationScore * w.utilization +
						concentrationScore * w.concentration +
						volatilityScore * w.volatility) /
						weightSum,
				)
			: 0;

	return {
		vaultAddress: snapshot.vaultAddress,
		liquidityScore,
		utilizationScore,
		concentrationScore,
		volatilityScore,
		composite,
		critical: composite < policy.criticalRiskFloor,
	};
}

export function computeRiskScores(
	snapshots: VaultMetricsSnapshot[],
	policy: RebalancePolicy,
): RiskScore[] {
	const referenceTvlUsd = Math.max(...snapshots.map((s) => s.tvlUsd), DEFAULT_REFERENCE_TVL_USD);
	return snapshots.map((snapshot) =>
		computeRiskScore(snapshot, policy, {
			allSnapshots: snapshots,
			referenceTvlUsd,
		}),
	);
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}
