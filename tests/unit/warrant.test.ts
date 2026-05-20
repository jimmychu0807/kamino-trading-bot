import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import type { TargetAllocation } from "../../src/strategy/types.ts";
import { shouldRebalance } from "../../src/strategy/warrant.ts";

const now = new Date("2026-05-20T00:00:00.000Z");

function makePolicy() {
	return parseOperatorConfig({
		solanaRpc: "https://rpc.example.com",
		privateKey: "5HueCGUQU5b",
		vaults: [
			{ address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E" },
			{ address: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo" },
			{ address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE" },
		],
		policy: {
			profile: "balanced",
			minTradeSizeBase: "1000000",
			minImprovementBps: 25,
			cooldownMs: 6 * 60 * 60 * 1000,
			driftBandPct: 2,
		},
	}).policy;
}

const targets: TargetAllocation[] = [
	{
		vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
		targetPct: 50,
		targetAmount: 500_000_000n,
		attractiveness: 0.08,
	},
	{
		vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
		targetPct: 30,
		targetAmount: 300_000_000n,
		attractiveness: 0.06,
	},
	{
		vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
		targetPct: 17,
		targetAmount: 170_000_000n,
		attractiveness: 0.05,
	},
];
const [target0, target1, target2] = targets as [
	TargetAllocation,
	TargetAllocation,
	TargetAllocation,
];

describe("shouldRebalance", () => {
	test("skips when drift is within driftBandPct", () => {
		const result = shouldRebalance({
			policy: makePolicy(),
			targets,
			currentAllocations: [
				{ vaultAddress: target0.vaultAddress, currentPct: 49.1 },
				{ vaultAddress: target1.vaultAddress, currentPct: 30.6 },
				{ vaultAddress: target2.vaultAddress, currentPct: 17.3 },
			],
			totalDeployableBase: 1_000_000_000n,
			expectedImprovementBps: 50,
			now,
		});

		expect(result.shouldRebalance).toBe(false);
		expect(result.reason).toBe("within_drift_band");
	});

	test("skips when cooldown is active", () => {
		const result = shouldRebalance({
			policy: makePolicy(),
			targets,
			currentAllocations: [
				{ vaultAddress: target0.vaultAddress, currentPct: 60 },
				{ vaultAddress: target1.vaultAddress, currentPct: 25 },
				{ vaultAddress: target2.vaultAddress, currentPct: 12 },
			],
			totalDeployableBase: 1_000_000_000n,
			expectedImprovementBps: 50,
			now,
			lastRebalanceAt: new Date(now.getTime() - 60 * 60 * 1000),
		});

		expect(result.shouldRebalance).toBe(false);
		expect(result.reason).toBe("cooldown_active");
	});

	test("skips when projected improvement is below minimum", () => {
		const result = shouldRebalance({
			policy: makePolicy(),
			targets,
			currentAllocations: [
				{ vaultAddress: target0.vaultAddress, currentPct: 58 },
				{ vaultAddress: target1.vaultAddress, currentPct: 24 },
				{ vaultAddress: target2.vaultAddress, currentPct: 15 },
			],
			totalDeployableBase: 1_000_000_000n,
			expectedImprovementBps: 10,
			now,
			lastRebalanceAt: new Date(now.getTime() - 7 * 60 * 60 * 1000),
		});

		expect(result.shouldRebalance).toBe(false);
		expect(result.reason).toBe("below_min_improvement");
	});

	test("skips when projected trade size is below minimum trade size", () => {
		const result = shouldRebalance({
			policy: makePolicy(),
			targets,
			currentAllocations: [
				{ vaultAddress: target0.vaultAddress, currentPct: 55 },
				{ vaultAddress: target1.vaultAddress, currentPct: 28 },
				{ vaultAddress: target2.vaultAddress, currentPct: 14 },
			],
			totalDeployableBase: 100_000n,
			expectedImprovementBps: 35,
			now,
			lastRebalanceAt: new Date(now.getTime() - 7 * 60 * 60 * 1000),
		});

		expect(result.shouldRebalance).toBe(false);
		expect(result.reason).toBe("below_min_trade_size");
	});

	test("critical risk exit bypasses cooldown and min improvement", () => {
		const result = shouldRebalance({
			policy: makePolicy(),
			targets,
			currentAllocations: [
				{ vaultAddress: target0.vaultAddress, currentPct: 50 },
				{ vaultAddress: target1.vaultAddress, currentPct: 35 },
				{ vaultAddress: target2.vaultAddress, currentPct: 12 },
			],
			totalDeployableBase: 1_000_000_000n,
			expectedImprovementBps: 0,
			now,
			lastRebalanceAt: new Date(now.getTime() - 60 * 60 * 1000),
			scores: [
				{
					vaultAddress: target1.vaultAddress,
					liquidityScore: 0.1,
					utilizationScore: 0.1,
					concentrationScore: 0.1,
					volatilityScore: 0.1,
					composite: 0.1,
					critical: true,
				},
			],
		});

		expect(result.shouldRebalance).toBe(true);
		expect(result.reason).toBe("critical_risk_exit");
		expect(result.criticalRiskExit).toBe(true);
	});
});
