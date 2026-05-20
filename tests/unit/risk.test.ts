import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import {
	computeConcentrationScore,
	computeLiquidityScore,
	computeRiskScore,
	computeRiskScores,
	computeUtilizationScore,
} from "../../src/strategy/risk.ts";

const policy = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	vaults: [
		{ address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E" },
		{ address: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo" },
		{ address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE" },
	],
	policy: { profile: "balanced", minTradeSizeBase: "1000000" },
}).policy;

function expectDefined<T>(value: T | undefined, message: string): T {
	expect(value).toBeDefined();
	if (value === undefined) throw new Error(message);
	return value;
}

describe("computeRiskScore", () => {
	test("liquidity score increases with TVL", () => {
		expect(computeLiquidityScore(1_000_000)).toBeLessThan(computeLiquidityScore(50_000_000));
	});

	test("utilization score favors lower utilization", () => {
		expect(computeUtilizationScore(0.9)).toBeLessThan(computeUtilizationScore(0.3));
	});

	test("concentration score penalizes single-reserve dominance", () => {
		expect(computeConcentrationScore([{ reserveAddress: "r1", weightPct: 90 }])).toBeLessThan(
			computeConcentrationScore([
				{ reserveAddress: "r1", weightPct: 40 },
				{ reserveAddress: "r2", weightPct: 60 },
			]),
		);
	});

	test("high APY vault with poor metrics scores below healthier vault (US2)", () => {
		const risky = buildMetricsSnapshot({
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			netApy: 0.12,
			tvlUsd: 1_000_000,
			utilization: 0.92,
			reserveWeights: [{ reserveAddress: "shared", weightPct: 95 }],
			yieldVolatility: 0.25,
		});
		const healthy = buildMetricsSnapshot({
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			netApy: 0.08,
			tvlUsd: 80_000_000,
			utilization: 0.35,
			reserveWeights: [
				{ reserveAddress: "shared", weightPct: 20 },
				{ reserveAddress: "r2", weightPct: 80 },
			],
			yieldVolatility: 0.03,
		});

		const scores = computeRiskScores([risky, healthy], policy);
		const riskyScore = expectDefined(
			scores.find((s) => s.vaultAddress === risky.vaultAddress),
			"Expected risky score to exist",
		);
		const healthyScore = expectDefined(
			scores.find((s) => s.vaultAddress === healthy.vaultAddress),
			"Expected healthy score to exist",
		);

		expect(riskyScore.composite).toBeLessThan(healthyScore.composite);
	});

	test("marks critical when composite below floor", () => {
		const snapshot = buildMetricsSnapshot({
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			netApy: 0.15,
			tvlUsd: 100_000,
			utilization: 0.99,
			reserveWeights: [{ reserveAddress: "r1", weightPct: 100 }],
			yieldVolatility: 0.8,
		});
		const score = computeRiskScore(snapshot, policy);
		expect(score.critical).toBe(true);
		expect(score.composite).toBeLessThan(policy.criticalRiskFloor);
	});

	test("applies cross-vault reserve concentration penalty (FR-017)", () => {
		const sharedReserve = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
		const a = buildMetricsSnapshot({
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			tvlUsd: 10_000_000,
			reserveWeights: [{ reserveAddress: sharedReserve, weightPct: 60 }],
		});
		const b = buildMetricsSnapshot({
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			tvlUsd: 10_000_000,
			reserveWeights: [{ reserveAddress: sharedReserve, weightPct: 55 }],
		});

		const alone = computeRiskScore(a, policy, { allSnapshots: [a] });
		const withOverlap = computeRiskScore(a, policy, { allSnapshots: [a, b] });

		expect(withOverlap.concentrationScore).toBeLessThanOrEqual(alone.concentrationScore);
	});
});
