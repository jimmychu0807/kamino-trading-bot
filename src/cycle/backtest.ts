import type { OperatorConfig, RebalancePolicy, VaultConfig } from "../config/schema.ts";
import type { AppDatabase } from "../db/client.ts";
import {
	groupSnapshotsByTimestamp,
	loadMetricSnapshots,
	persistMetricSnapshots,
} from "../db/metrics.ts";
import { importHistoricalMetrics } from "../kamino/metrics-history.ts";
import { computeTargetsFromSnapshots } from "../strategy/allocate.ts";
import { estimateExpectedImprovementBps } from "../strategy/improvement.ts";
import type { RiskScore, TargetAllocation, VaultMetricsSnapshot } from "../strategy/types.ts";
import { type CurrentAllocation, shouldRebalance } from "../strategy/warrant.ts";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const NORMALIZED_DEPLOYABLE = 1_000_000n;

export type BacktestOptions = {
	config: OperatorConfig;
	db: AppDatabase;
	/** Frozen policy for the replay (defaults to config.policy). */
	policy?: RebalancePolicy;
	vaults?: VaultConfig[];
	start?: Date;
	end?: Date;
	/** When true, fetch Kamino API history and persist before replay. */
	importFromApi?: boolean;
	rpcTimeoutMs?: number;
};

export type BacktestStepSummary = {
	timestamp: string;
	strategyReturn: number;
	baselineReturn: number;
	rebalanced: boolean;
	reason: string;
};

export type BacktestReport = {
	start: string | null;
	end: string | null;
	steps: number;
	rebalanceCount: number;
	strategyCumulativeRiskAdjustedReturn: number;
	equalWeightCumulativeRiskAdjustedReturn: number;
	relativeImprovementPct: number;
	summary: string;
	stepsDetail: BacktestStepSummary[];
};

export type AllocationMap = Map<string, number>;

export function equalWeightAllocations(
	vaultAddresses: string[],
	deployablePct: number,
): AllocationMap {
	const each = deployablePct / vaultAddresses.length;
	return new Map(vaultAddresses.map((vault) => [vault, each]));
}

export function allocationsToCurrent(allocations: AllocationMap): CurrentAllocation[] {
	return [...allocations.entries()].map(([vaultAddress, currentPct]) => ({
		vaultAddress,
		currentPct,
	}));
}

export function applyTargetAllocations(
	allocations: AllocationMap,
	targets: TargetAllocation[],
): void {
	for (const target of targets) {
		allocations.set(target.vaultAddress, target.targetPct);
	}
}

/** Period risk-adjusted return: Σ(weight × APY × composite). */
export function periodRiskAdjustedReturn(
	allocations: AllocationMap,
	snapshots: VaultMetricsSnapshot[],
	scores: RiskScore[],
	dtMs: number,
): number {
	const apyByVault = new Map(snapshots.map((s) => [s.vaultAddress, s.netApy]));
	const compositeByVault = new Map(scores.map((s) => [s.vaultAddress, s.composite]));
	const dtYears = dtMs / MS_PER_YEAR;

	let weighted = 0;
	for (const [vaultAddress, weightPct] of allocations) {
		const apy = apyByVault.get(vaultAddress) ?? 0;
		const composite = compositeByVault.get(vaultAddress) ?? 0;
		weighted += (weightPct / 100) * apy * composite;
	}

	return weighted * dtYears;
}

export function simulateBacktestSteps(
	timesteps: VaultMetricsSnapshot[][],
	policy: RebalancePolicy,
	vaultConfigs: VaultConfig[],
): {
	strategyCumulative: number;
	baselineCumulative: number;
	rebalanceCount: number;
	stepsDetail: BacktestStepSummary[];
} {
	const vaultAddresses = vaultConfigs.map((v) => v.address);
	const deployablePct = 100 - policy.cashBufferPct;

	const strategyAlloc = equalWeightAllocations(vaultAddresses, deployablePct);
	const baselineAlloc = equalWeightAllocations(vaultAddresses, deployablePct);

	let strategyCumulative = 0;
	let baselineCumulative = 0;
	let rebalanceCount = 0;
	let lastRebalanceAt: Date | null = null;
	const stepsDetail: BacktestStepSummary[] = [];

	for (let i = 0; i < timesteps.length; i++) {
		const snapshots = timesteps[i];
		if (!snapshots?.[0]) continue;
		const capturedAt = snapshots[0].capturedAt;
		const nextAt = timesteps[i + 1]?.[0]?.capturedAt;
		const dtMs =
			nextAt !== undefined
				? Math.max(0, nextAt.getTime() - capturedAt.getTime())
				: 24 * 60 * 60 * 1000;

		const { scores, targets } = computeTargetsFromSnapshots(
			snapshots,
			policy,
			vaultConfigs,
			NORMALIZED_DEPLOYABLE,
		);

		const currentAllocations = allocationsToCurrent(strategyAlloc);
		const improvementBps = estimateExpectedImprovementBps(snapshots, currentAllocations, targets);
		const warrant = shouldRebalance({
			policy,
			targets,
			currentAllocations,
			totalDeployableBase: NORMALIZED_DEPLOYABLE,
			expectedImprovementBps: improvementBps,
			now: capturedAt,
			lastRebalanceAt,
			scores,
		});

		let rebalanced = false;
		if (warrant.shouldRebalance) {
			applyTargetAllocations(strategyAlloc, targets);
			lastRebalanceAt = capturedAt;
			rebalanceCount += 1;
			rebalanced = true;
		}

		const strategyReturn = periodRiskAdjustedReturn(strategyAlloc, snapshots, scores, dtMs);
		const baselineReturn = periodRiskAdjustedReturn(baselineAlloc, snapshots, scores, dtMs);

		strategyCumulative += strategyReturn;
		baselineCumulative += baselineReturn;

		stepsDetail.push({
			timestamp: capturedAt.toISOString(),
			strategyReturn,
			baselineReturn,
			rebalanced,
			reason: warrant.reason,
		});
	}

	return {
		strategyCumulative,
		baselineCumulative,
		rebalanceCount,
		stepsDetail,
	};
}

export function buildBacktestReport(params: {
	timesteps: VaultMetricsSnapshot[][];
	strategyCumulative: number;
	baselineCumulative: number;
	rebalanceCount: number;
	stepsDetail: BacktestStepSummary[];
}): BacktestReport {
	const first = params.timesteps[0]?.[0]?.capturedAt;
	const last = params.timesteps[params.timesteps.length - 1]?.[0]?.capturedAt;
	const relativeImprovementPct =
		params.baselineCumulative !== 0
			? ((params.strategyCumulative - params.baselineCumulative) /
					Math.abs(params.baselineCumulative)) *
				100
			: params.strategyCumulative > 0
				? 100
				: 0;

	const summary = [
		`steps=${params.timesteps.length}`,
		`rebalances=${params.rebalanceCount}`,
		`strategy_risk_adj_return=${params.strategyCumulative.toFixed(6)}`,
		`equal_weight_risk_adj_return=${params.baselineCumulative.toFixed(6)}`,
		`relative_improvement_pct=${relativeImprovementPct.toFixed(2)}`,
	].join("; ");

	return {
		start: first?.toISOString() ?? null,
		end: last?.toISOString() ?? null,
		steps: params.timesteps.length,
		rebalanceCount: params.rebalanceCount,
		strategyCumulativeRiskAdjustedReturn: params.strategyCumulative,
		equalWeightCumulativeRiskAdjustedReturn: params.baselineCumulative,
		relativeImprovementPct,
		summary,
		stepsDetail: params.stepsDetail,
	};
}

/** FR-016: replay allocation logic over stored or imported metric history (no on-chain sends). */
export async function runBacktest(opts: BacktestOptions): Promise<BacktestReport> {
	const policy = opts.policy ?? opts.config.policy;
	const vaultConfigs = opts.vaults ?? opts.config.vaults;
	const vaultAddresses = vaultConfigs.map((v) => v.address);

	if (opts.importFromApi) {
		const imported = await importHistoricalMetrics({
			vaultAddresses,
			start: opts.start,
			end: opts.end,
			timeoutMs: opts.rpcTimeoutMs ?? opts.config.rpcTimeoutMs,
		});
		await persistMetricSnapshots(opts.db, imported);
	}

	const snapshots = await loadMetricSnapshots(opts.db, {
		vaultAddresses,
		start: opts.start,
		end: opts.end,
	});

	const timesteps = groupSnapshotsByTimestamp(snapshots, vaultAddresses);
	if (timesteps.length === 0) {
		return buildBacktestReport({
			timesteps: [],
			strategyCumulative: 0,
			baselineCumulative: 0,
			rebalanceCount: 0,
			stepsDetail: [],
		});
	}

	const { strategyCumulative, baselineCumulative, rebalanceCount, stepsDetail } =
		simulateBacktestSteps(timesteps, policy, vaultConfigs);

	return buildBacktestReport({
		timesteps,
		strategyCumulative,
		baselineCumulative,
		rebalanceCount,
		stepsDetail,
	});
}
