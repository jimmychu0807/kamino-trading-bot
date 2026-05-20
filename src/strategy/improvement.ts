import type { TargetAllocation, VaultMetricsSnapshot } from "./types.ts";
import type { CurrentAllocation } from "./warrant.ts";

/** Projected APY improvement (bps) from moving toward target weights. */
export function estimateExpectedImprovementBps(
	snapshots: VaultMetricsSnapshot[],
	currentAllocations: CurrentAllocation[],
	targets: TargetAllocation[],
): number {
	const apyByVault = new Map(snapshots.map((s) => [s.vaultAddress, s.netApy]));
	const currentByVault = new Map(currentAllocations.map((a) => [a.vaultAddress, a.currentPct]));

	let currentWeighted = 0;
	let targetWeighted = 0;

	for (const target of targets) {
		const apy = apyByVault.get(target.vaultAddress) ?? 0;
		const currentPct = currentByVault.get(target.vaultAddress) ?? 0;
		currentWeighted += (currentPct / 100) * apy;
		targetWeighted += (target.targetPct / 100) * apy;
	}

	return Math.max(0, Math.round((targetWeighted - currentWeighted) * 100));
}
