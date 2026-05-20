import type {
	RebalancePolicy,
	RiskProfile,
	VaultConfig,
} from "../config/schema.ts";
import { RISK_PROFILE_PRESETS } from "../config/schema.ts";
import { computeRiskScores } from "./risk.ts";
import type {
	RiskScore,
	TargetAllocation,
	VaultMetricsSnapshot,
} from "./types.ts";

const EPSILON_ALLOCATION = 1e-9;
const EPSILON_TOTAL_PCT = 1e-6;

/** FR-004: combine expected return with composite safety score. */
export function computeAttractiveness(
	netApy: number,
	composite: number,
): number {
	if (netApy <= 0 || composite <= 0) return 0;
	return netApy * composite;
}

/** Policy fields derived from risk profile preset (T026). */
export function allocationParamsFromPolicy(policy: RebalancePolicy) {
	const preset = RISK_PROFILE_PRESETS[policy.profile as RiskProfile];
	return {
		deployablePct: 100 - policy.cashBufferPct,
		maxSingleVaultPct: policy.maxSingleVaultPct,
		criticalRiskFloor: policy.criticalRiskFloor,
		presetMaxSingleVaultPct: preset.maxSingleVaultPct,
	};
}

export function computeTargetAllocations(
	snapshots: VaultMetricsSnapshot[],
	scores: RiskScore[],
	policy: RebalancePolicy,
	vaultConfigs: VaultConfig[],
	totalDeployable: bigint,
): TargetAllocation[] {
	const scoreByVault = new Map(scores.map((s) => [s.vaultAddress, s]));
	const snapshotByVault = new Map(snapshots.map((s) => [s.vaultAddress, s]));

	const { deployablePct, maxSingleVaultPct } =
		allocationParamsFromPolicy(policy);

	const enabledVaults = vaultConfigs.filter((v) => v.enabled !== false);
	const weights: { address: string; raw: number; min: number; max: number }[] =
		[];

	for (const vault of enabledVaults) {
		const score = scoreByVault.get(vault.address);
		const snapshot = snapshotByVault.get(vault.address);
		if (!score || !snapshot) continue;

		const min = vault.minAllocationPct;
		const max = Math.min(
			vault.maxAllocationPct ?? maxSingleVaultPct,
			maxSingleVaultPct,
		);

		let raw = 0;
		if (!score.critical) {
			raw = computeAttractiveness(snapshot.netApy, score.composite);
		}

		weights.push({ address: vault.address, raw, min, max });
	}

	const allocated = distributeWithCaps(weights, deployablePct);

	return allocated.flatMap(({ address, targetPct }) => {
		const snapshot = snapshotByVault.get(address);
		const score = scoreByVault.get(address);
		if (!snapshot || !score) return [];
		const amount =
			totalDeployable > 0n
				? (totalDeployable * BigInt(Math.round(targetPct * 100))) / 10000n
				: 0n;
		return [
			{
				vaultAddress: address,
				targetPct,
				targetAmount: amount,
				attractiveness: score.critical
					? 0
					: computeAttractiveness(snapshot.netApy, score.composite),
			},
		];
	});
}

/** Score all snapshots and derive targets in one call. */
export function computeTargetsFromSnapshots(
	snapshots: VaultMetricsSnapshot[],
	policy: RebalancePolicy,
	vaultConfigs: VaultConfig[],
	totalDeployable: bigint,
): { scores: RiskScore[]; targets: TargetAllocation[] } {
	const scores = computeRiskScores(snapshots, policy);
	const targets = computeTargetAllocations(
		snapshots,
		scores,
		policy,
		vaultConfigs,
		totalDeployable,
	);
	return { scores, targets };
}

function distributeWithCaps(
	entries: { address: string; raw: number; min: number; max: number }[],
	totalPct: number,
): { address: string; targetPct: number }[] {
	if (entries.length === 0) return [];

	const result = new Map<string, number>();
	for (const e of entries) result.set(e.address, 0);

	let remaining = totalPct;
	const fixed = new Set<string>();

	// Critical / zero-weight vaults still receive min allocation if set.
	for (const e of entries) {
		if (e.raw <= 0 && e.min > 0) {
			const grant = Math.min(e.min, e.max, remaining);
			result.set(e.address, grant);
			remaining -= grant;
			fixed.add(e.address);
		}
	}

	const fluid = entries.filter((e) => !fixed.has(e.address));
	let guard = 0;

	while (fluid.length > 0 && remaining > EPSILON_ALLOCATION && guard < 32) {
		guard += 1;
		const rawSum = fluid.reduce((s, e) => s + e.raw, 0);
		const nextFluid: typeof fluid = [];

		for (const e of fluid) {
			const share =
				rawSum > 0 ? (e.raw / rawSum) * remaining : remaining / fluid.length;
			const current = result.get(e.address) ?? 0;
			const capRoom = e.max - current;
			const grant = Math.min(share, capRoom, remaining);

			result.set(e.address, current + grant);
			remaining -= grant;

			if (
				current + grant < e.max - EPSILON_ALLOCATION &&
				share > grant + EPSILON_ALLOCATION
			) {
				nextFluid.push(e);
			}
		}

		if (nextFluid.length === fluid.length) break;
		fluid.length = 0;
		fluid.push(...nextFluid);
	}

	// Assign leftover to highest raw weight under cap.
	if (remaining > EPSILON_ALLOCATION) {
		const sorted = [...entries].sort((a, b) => b.raw - a.raw);
		for (const e of sorted) {
			const current = result.get(e.address) ?? 0;
			const room = e.max - current;
			if (room <= EPSILON_ALLOCATION) continue;
			const grant = Math.min(room, remaining);
			result.set(e.address, current + grant);
			remaining -= grant;
			if (remaining <= EPSILON_ALLOCATION) break;
		}
	}

	// Enforce minimums (may slightly exceed total — trim from largest).
	for (const e of entries) {
		const current = result.get(e.address) ?? 0;
		if (current < e.min) {
			result.set(e.address, Math.min(e.min, e.max));
		}
	}

	let sum = [...result.values()].reduce((s, v) => s + v, 0);
	if (sum > totalPct + EPSILON_TOTAL_PCT) {
		const excess = sum - totalPct;
		const largest = [...result.entries()].sort((a, b) => b[1] - a[1])[0];
		if (largest) {
			result.set(largest[0], Math.max(0, largest[1] - excess));
		}
		sum = [...result.values()].reduce((s, v) => s + v, 0);
	}

	// Spread any rounding remainder.
	const drift = totalPct - sum;
	if (Math.abs(drift) > EPSILON_TOTAL_PCT && entries.length > 0) {
		const first = entries[0];
		if (!first) return [];
		const current = result.get(first.address) ?? 0;
		result.set(first.address, clamp(current + drift, first.min, first.max));
	}

	return entries.map((e) => ({
		address: e.address,
		targetPct: roundPct(result.get(e.address) ?? 0),
	}));
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function roundPct(value: number): number {
	return Math.round(value * 1000) / 1000;
}
