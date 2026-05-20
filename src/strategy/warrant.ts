import type { RebalancePolicy } from "../config/schema.ts";
import type { RiskScore, TargetAllocation } from "./types.ts";

export type CurrentAllocation = {
	vaultAddress: string;
	currentPct: number;
};

export type ShouldRebalanceInput = {
	policy: RebalancePolicy;
	targets: TargetAllocation[];
	currentAllocations: CurrentAllocation[];
	totalDeployableBase: bigint;
	expectedImprovementBps: number;
	now?: Date;
	lastRebalanceAt?: Date | null;
	scores?: RiskScore[];
};

export type ShouldRebalanceReason =
	| "critical_risk_exit"
	| "within_drift_band"
	| "cooldown_active"
	| "below_min_improvement"
	| "below_min_trade_size"
	| "rebalance_warranted";

export type ShouldRebalanceResult = {
	shouldRebalance: boolean;
	reason: ShouldRebalanceReason;
	maxDriftPct: number;
	projectedTradeSizeBase: bigint;
	criticalRiskExit: boolean;
};

const EPSILON_PCT = 1e-6;

export function shouldRebalance(
	input: ShouldRebalanceInput,
): ShouldRebalanceResult {
	const now = input.now ?? new Date();
	const maxDriftPct = computeMaxDriftPct(
		input.currentAllocations,
		input.targets,
	);
	const projectedTradeSizeBase = estimateTradeSizeBase(
		input.totalDeployableBase,
		maxDriftPct,
	);

	const criticalRiskExit = hasCriticalRiskExit(
		input.scores ?? [],
		input.currentAllocations,
		input.targets,
	);
	if (criticalRiskExit) {
		return {
			shouldRebalance: true,
			reason: "critical_risk_exit",
			maxDriftPct,
			projectedTradeSizeBase,
			criticalRiskExit: true,
		};
	}

	if (maxDriftPct <= input.policy.driftBandPct + EPSILON_PCT) {
		return {
			shouldRebalance: false,
			reason: "within_drift_band",
			maxDriftPct,
			projectedTradeSizeBase,
			criticalRiskExit: false,
		};
	}

	if (isCooldownActive(input.lastRebalanceAt, now, input.policy.cooldownMs)) {
		return {
			shouldRebalance: false,
			reason: "cooldown_active",
			maxDriftPct,
			projectedTradeSizeBase,
			criticalRiskExit: false,
		};
	}

	if (input.expectedImprovementBps < input.policy.minImprovementBps) {
		return {
			shouldRebalance: false,
			reason: "below_min_improvement",
			maxDriftPct,
			projectedTradeSizeBase,
			criticalRiskExit: false,
		};
	}

	if (projectedTradeSizeBase < input.policy.minTradeSizeBase) {
		return {
			shouldRebalance: false,
			reason: "below_min_trade_size",
			maxDriftPct,
			projectedTradeSizeBase,
			criticalRiskExit: false,
		};
	}

	return {
		shouldRebalance: true,
		reason: "rebalance_warranted",
		maxDriftPct,
		projectedTradeSizeBase,
		criticalRiskExit: false,
	};
}

export function computeMaxDriftPct(
	currentAllocations: CurrentAllocation[],
	targets: Pick<TargetAllocation, "vaultAddress" | "targetPct">[],
): number {
	const currentByVault = new Map(
		currentAllocations.map((allocation) => [
			allocation.vaultAddress,
			allocation.currentPct,
		]),
	);

	let maxDrift = 0;
	for (const target of targets) {
		const currentPct = currentByVault.get(target.vaultAddress) ?? 0;
		const drift = Math.abs(currentPct - target.targetPct);
		if (drift > maxDrift) {
			maxDrift = drift;
		}
	}

	return maxDrift;
}

export function estimateTradeSizeBase(
	totalDeployableBase: bigint,
	maxDriftPct: number,
): bigint {
	if (totalDeployableBase <= 0n || maxDriftPct <= 0) {
		return 0n;
	}
	const driftBps = BigInt(Math.round(maxDriftPct * 100));
	return (totalDeployableBase * driftBps) / 10_000n;
}

function isCooldownActive(
	lastRebalanceAt: Date | null | undefined,
	now: Date,
	cooldownMs: number,
): boolean {
	if (!lastRebalanceAt || cooldownMs <= 0) {
		return false;
	}
	return now.getTime() - lastRebalanceAt.getTime() < cooldownMs;
}

function hasCriticalRiskExit(
	scores: RiskScore[],
	currentAllocations: CurrentAllocation[],
	targets: Pick<TargetAllocation, "vaultAddress" | "targetPct">[],
): boolean {
	const criticalVaults = new Set(
		scores.filter((score) => score.critical).map((score) => score.vaultAddress),
	);
	if (criticalVaults.size === 0) {
		return false;
	}

	const currentByVault = new Map(
		currentAllocations.map((allocation) => [
			allocation.vaultAddress,
			allocation.currentPct,
		]),
	);
	const targetByVault = new Map(
		targets.map((target) => [target.vaultAddress, target.targetPct]),
	);

	for (const vaultAddress of criticalVaults) {
		const currentPct = currentByVault.get(vaultAddress) ?? 0;
		const targetPct = targetByVault.get(vaultAddress) ?? 0;
		if (currentPct > targetPct + EPSILON_PCT) {
			return true;
		}
	}
	return false;
}
