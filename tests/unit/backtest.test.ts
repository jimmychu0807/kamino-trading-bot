import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import {
	allocationsToCurrent,
	buildBacktestReport,
	equalWeightAllocations,
	periodRiskAdjustedReturn,
	runBacktest,
	simulateBacktestSteps,
} from "../../src/cycle/backtest.ts";
import { persistMetricSnapshots } from "../../src/db/metrics.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import {
	historicalPointToSnapshot,
	parseHistoricalMetricsPoint,
} from "../../src/kamino/metrics-history.ts";
import { computeRiskScores } from "../../src/strategy/risk.ts";
import { createTestDb } from "../helpers/test-db.ts";

const vaultAddresses = [
	"HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	"A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
	"DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
] as const;

const config = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	vaults: vaultAddresses.map((address) => ({ address })),
	policy: {
		profile: "aggressive",
		minTradeSizeBase: "1",
		minImprovementBps: 0,
		cooldownMs: 0,
		driftBandPct: 0,
	},
});

function snapshotsAt(base: Date, apys: [number, number, number]) {
	return vaultAddresses.map((vaultAddress, i) =>
		buildMetricsSnapshot({
			vaultAddress,
			capturedAt: base,
			netApy: apys[i] ?? 0,
			tvlUsd: 50_000_000,
			utilization: 0.3,
			reserveWeights: [
				{ reserveAddress: `r${i}a`, weightPct: 50 },
				{ reserveAddress: `r${i}b`, weightPct: 50 },
			],
			source: "api",
			fresh: true,
		}),
	);
}

describe("historical metrics import", () => {
	test("parses Kamino API point into VaultMetricsSnapshot", () => {
		const point = parseHistoricalMetricsPoint({
			timestamp: "2026-04-02T00:00:00.000Z",
			tvl: "1000000",
			solTvl: "1",
			apy: "0.3",
			apyTheoretical: "0.3",
			apyActual: "0.29",
			apyFarmRewards: "0",
			apyReservesIncentives: "0",
			apyIncentives: "0",
			sharePrice: "1",
			interest: "0",
			interestUsd: "0",
			interestSol: "0",
			reserves: [
				{
					pubkey: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
					supplyApy: "0.36",
					rewardsApy: "0",
					allocationRatio: "0.8",
					rewardTokens: [],
				},
			],
			vaultRewards: [],
		});

		const snapshot = historicalPointToSnapshot(vaultAddresses[0], point);
		expect(snapshot.netApy).toBeCloseTo(0.29, 5);
		expect(snapshot.tvlUsd).toBe(1_000_000);
		expect(snapshot.source).toBe("api");
		expect(snapshot.reserveWeights.length).toBe(1);
	});
});

describe("backtest simulation", () => {
	test("strategy outperforms equal-weight when high-APY vault has better risk", () => {
		const t0 = new Date("2026-05-01T00:00:00.000Z");
		const t1 = new Date("2026-05-02T00:00:00.000Z");
		const t2 = new Date("2026-05-03T00:00:00.000Z");

		const timesteps = [
			snapshotsAt(t0, [0.12, 0.1, 0.08]),
			snapshotsAt(t1, [0.14, 0.1, 0.07]),
			snapshotsAt(t2, [0.15, 0.09, 0.06]),
		];

		const result = simulateBacktestSteps(timesteps, config.policy, config.vaults);
		expect(result.rebalanceCount).toBeGreaterThan(0);
		expect(result.strategyCumulative).toBeGreaterThan(result.baselineCumulative);
	});

	test("frozen policy override is independent of config.policy mutations", () => {
		const frozenPolicy = { ...config.policy, minImprovementBps: 0, cooldownMs: 0 };
		const strictPolicy = { ...config.policy, minImprovementBps: 10_000, cooldownMs: 0 };
		const t0 = new Date("2026-05-01T00:00:00.000Z");
		const timesteps = [snapshotsAt(t0, [0.12, 0.1, 0.08])];

		const permissive = simulateBacktestSteps(timesteps, frozenPolicy, config.vaults);
		const strict = simulateBacktestSteps(timesteps, strictPolicy, config.vaults);
		expect(permissive.rebalanceCount).toBeGreaterThanOrEqual(strict.rebalanceCount);
	});

	test("periodRiskAdjustedReturn uses allocation weights and composite scores", () => {
		const snapshots = snapshotsAt(new Date(), [0.1, 0.08, 0.06]);
		const scores = computeRiskScores(snapshots, config.policy);
		const alloc = equalWeightAllocations([...vaultAddresses], 100);
		const value = periodRiskAdjustedReturn(alloc, snapshots, scores, 86_400_000);
		expect(value).toBeGreaterThan(0);
	});
});

describe("runBacktest", () => {
	test("replays stored snapshots without send* or live cycle", async () => {
		const db = createTestDb();
		const t0 = new Date("2026-05-10T00:00:00.000Z");
		const t1 = new Date("2026-05-11T00:00:00.000Z");
		await persistMetricSnapshots(db, [
			...snapshotsAt(t0, [0.12, 0.09, 0.07]),
			...snapshotsAt(t1, [0.13, 0.09, 0.06]),
		]);

		const report = await runBacktest({
			config,
			db,
			policy: config.policy,
		});

		expect(report.steps).toBe(2);
		expect(report.strategyCumulativeRiskAdjustedReturn).toBeGreaterThanOrEqual(
			report.equalWeightCumulativeRiskAdjustedReturn,
		);
		expect(report.summary).toContain("strategy_risk_adj_return");
		expect(report.summary).toContain("equal_weight_risk_adj_return");
	});

	test("empty history returns zeroed report", async () => {
		const db = createTestDb();
		const report = await runBacktest({ config, db });
		expect(report.steps).toBe(0);
		expect(report.rebalanceCount).toBe(0);
	});
});

describe("buildBacktestReport", () => {
	test("formats relative improvement in summary", () => {
		const report = buildBacktestReport({
			timesteps: [snapshotsAt(new Date(), [0.1, 0.09, 0.08])],
			strategyCumulative: 0.02,
			baselineCumulative: 0.01,
			rebalanceCount: 1,
			stepsDetail: [],
		});
		expect(report.relativeImprovementPct).toBeCloseTo(100, 0);
		expect(report.summary).toContain("relative_improvement_pct");
	});
});

describe("allocation helpers", () => {
	test("allocationsToCurrent maps weights", () => {
		const map = equalWeightAllocations([vaultAddresses[0], vaultAddresses[1]], 99);
		const current = allocationsToCurrent(map);
		expect(current).toHaveLength(2);
		expect(current[0]?.currentPct).toBeCloseTo(49.5, 1);
	});
});
