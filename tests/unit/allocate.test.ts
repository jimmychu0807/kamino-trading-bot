import { describe, expect, test } from "bun:test";
import { parseOperatorConfig, RISK_PROFILE_PRESETS } from "../../src/config/schema.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import {
	allocationParamsFromPolicy,
	computeAttractiveness,
	computeTargetAllocations,
	computeTargetsFromSnapshots,
} from "../../src/strategy/allocate.ts";
import { computeRiskScores } from "../../src/strategy/risk.ts";

const vaultAddresses = [
	"HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	"A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
	"DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
] as const;

function expectDefined<T>(value: T | undefined, message: string): T {
	expect(value).toBeDefined();
	if (value === undefined) throw new Error(message);
	return value;
}

function makeConfig(profile: "conservative" | "balanced" | "aggressive" = "balanced") {
	return parseOperatorConfig({
		solanaRpc: "https://rpc.example.com",
		privateKey: "5HueCGUQU5b",
		vaults: vaultAddresses.map((address) => ({ address })),
		policy: { profile, minTradeSizeBase: "1000000" },
	});
}

describe("computeTargetAllocations", () => {
	test("targets sum to 100% minus cash buffer", () => {
		const cfg = makeConfig();
		const snapshots = vaultAddresses.map((vaultAddress, i) =>
			buildMetricsSnapshot({
				vaultAddress,
				netApy: 0.06 + i * 0.01,
				tvlUsd: 20_000_000,
				utilization: 0.4,
				reserveWeights: [
					{ reserveAddress: `r${i}a`, weightPct: 50 },
					{ reserveAddress: `r${i}b`, weightPct: 50 },
				],
			}),
		);
		const scores = computeRiskScores(snapshots, cfg.policy);
		const targets = computeTargetAllocations(
			snapshots,
			scores,
			cfg.policy,
			cfg.vaults,
			1_000_000_000n,
		);

		const sum = targets.reduce((s, t) => s + t.targetPct, 0);
		expect(sum).toBeCloseTo(100 - cfg.policy.cashBufferPct, 2);
	});

	test("respects per-vault max caps", () => {
		const cfg = makeConfig("conservative");
		const snapshots = [
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[0],
				netApy: 0.2,
				tvlUsd: 100_000_000,
				utilization: 0.2,
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[1],
				netApy: 0.05,
				tvlUsd: 20_000_000,
				utilization: 0.5,
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[2],
				netApy: 0.04,
				tvlUsd: 20_000_000,
				utilization: 0.5,
			}),
		];
		const { targets } = computeTargetsFromSnapshots(
			snapshots,
			cfg.policy,
			cfg.vaults,
			500_000_000n,
		);

		for (const t of targets) {
			expect(t.targetPct).toBeLessThanOrEqual(cfg.policy.maxSingleVaultPct + 0.01);
		}
	});

	test("critical vault receives no attractiveness weight", () => {
		const cfg = makeConfig();
		const snapshots = [
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[0],
				netApy: 0.2,
				tvlUsd: 50_000_000,
				utilization: 0.3,
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[1],
				netApy: 0.15,
				tvlUsd: 100_000,
				utilization: 0.99,
				reserveWeights: [{ reserveAddress: "r1", weightPct: 100 }],
				yieldVolatility: 0.9,
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[2],
				netApy: 0.07,
				tvlUsd: 40_000_000,
				utilization: 0.35,
			}),
		];
		const scores = computeRiskScores(snapshots, cfg.policy);
		const critical = scores.find((s) => s.critical);
		expect(critical).toBeDefined();

		const targets = computeTargetAllocations(
			snapshots,
			scores,
			cfg.policy,
			cfg.vaults,
			1_000_000_000n,
		);
		const criticalVaultAddress = expectDefined(
			critical?.vaultAddress,
			"Expected a critical vault score for this fixture",
		);
		const criticalTarget = targets.find((t) => t.vaultAddress === criticalVaultAddress);
		const definedCriticalTarget = expectDefined(
			criticalTarget,
			"Expected critical target to exist",
		);
		expect(definedCriticalTarget.attractiveness).toBe(0);
		expect(definedCriticalTarget.targetPct).toBeLessThan(
			Math.max(
				...targets.filter((t) => t.vaultAddress !== criticalVaultAddress).map((t) => t.targetPct),
			),
		);
	});

	test("favors healthier vault over high-APY risky vault (US2)", () => {
		const cfg = makeConfig();
		const snapshots = [
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[0],
				netApy: 0.08,
				tvlUsd: 80_000_000,
				utilization: 0.35,
				reserveWeights: [
					{ reserveAddress: "r1", weightPct: 30 },
					{ reserveAddress: "r2", weightPct: 70 },
				],
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[1],
				netApy: 0.12,
				tvlUsd: 1_000_000,
				utilization: 0.92,
				reserveWeights: [{ reserveAddress: "r1", weightPct: 95 }],
				yieldVolatility: 0.25,
			}),
			buildMetricsSnapshot({
				vaultAddress: vaultAddresses[2],
				netApy: 0.06,
				tvlUsd: 30_000_000,
				utilization: 0.4,
			}),
		];
		const { targets } = computeTargetsFromSnapshots(
			snapshots,
			cfg.policy,
			cfg.vaults,
			1_000_000_000n,
		);
		const healthy = expectDefined(
			targets.find((t) => t.vaultAddress === vaultAddresses[0]),
			"Expected healthy vault target to exist",
		);
		const risky = expectDefined(
			targets.find((t) => t.vaultAddress === vaultAddresses[1]),
			"Expected risky vault target to exist",
		);
		expect(healthy.targetPct).toBeGreaterThan(risky.targetPct);
	});

	test("maps risk profile presets via allocationParamsFromPolicy (T026)", () => {
		const aggressive = makeConfig("aggressive");
		const params = allocationParamsFromPolicy(aggressive.policy);
		expect(params.maxSingleVaultPct).toBe(RISK_PROFILE_PRESETS.aggressive.maxSingleVaultPct);
		expect(params.deployablePct).toBe(100 - aggressive.policy.cashBufferPct);
	});

	test("computeAttractiveness combines APY and composite", () => {
		expect(computeAttractiveness(0.1, 0.8)).toBeCloseTo(0.08, 6);
		expect(computeAttractiveness(0, 0.9)).toBe(0);
	});
});
