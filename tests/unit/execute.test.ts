import { describe, expect, test } from "bun:test";
import {
	executeRebalanceActions,
	planRebalanceActions,
	type RebalanceAction,
} from "../../src/cycle/execute.ts";
import type { WalletPosition } from "../../src/kamino/reconcile.ts";
import type { TargetAllocation } from "../../src/strategy/types.ts";

const position: WalletPosition = {
	walletAddress: "wallet",
	tokenBalance: 100n,
	vaultShares: [
		{ vaultAddress: "v1", shares: 1n, valueBase: 600n },
		{ vaultAddress: "v2", shares: 1n, valueBase: 250n },
		{ vaultAddress: "v3", shares: 1n, valueBase: 50n },
	],
	totalDeployable: 1_000n,
};

const targets: TargetAllocation[] = [
	{
		vaultAddress: "v1",
		targetPct: 40,
		targetAmount: 400n,
		attractiveness: 0.4,
	},
	{
		vaultAddress: "v2",
		targetPct: 30,
		targetAmount: 300n,
		attractiveness: 0.3,
	},
	{
		vaultAddress: "v3",
		targetPct: 20,
		targetAmount: 200n,
		attractiveness: 0.2,
	},
];

describe("rebalance leg planning", () => {
	test("returns no legs when warrant is false", () => {
		const planned = planRebalanceActions({
			position,
			targets,
			warrant: {
				shouldRebalance: false,
				reason: "within_drift_band",
				maxDriftPct: 0.5,
				projectedTradeSizeBase: 5n,
				criticalRiskExit: false,
			},
		});

		expect(planned).toEqual([]);
	});

	test("plans withdraw legs before deposit legs when warrant is true", () => {
		const planned = planRebalanceActions({
			position,
			targets,
			warrant: {
				shouldRebalance: true,
				reason: "rebalance_warranted",
				maxDriftPct: 20,
				projectedTradeSizeBase: 300n,
				criticalRiskExit: false,
			},
		});

		expect(planned.map((leg) => leg.phase)).toEqual([
			"withdrawal",
			"deposit",
			"deposit",
		]);
		expect(planned[0]).toMatchObject({
			vaultAddress: "v1",
			kind: "withdraw",
			amountBase: 200n,
		});
	});

	test("stops immediately on first failed leg (partial cycle)", async () => {
		const actions: RebalanceAction[] = [
			{
				vaultAddress: "v1",
				kind: "withdraw",
				phase: "withdrawal",
				amountBase: 10n,
			},
			{
				vaultAddress: "v2",
				kind: "deposit",
				phase: "deposit",
				amountBase: 10n,
			},
		];

		let calls = 0;
		const result = await executeRebalanceActions({
			clients: {} as never,
			signer: {} as never,
			actions,
			createVaultIxBuilder: () => ({
				withdrawIxs: async () => [] as never[],
				depositIxs: async () => [] as never[],
			}),
			sendInstructions: async () => {
				calls += 1;
				throw new Error("send failed");
			},
		});

		expect(calls).toBe(1);
		expect(result.status).toBe("partial");
		expect(result.actions).toHaveLength(1);
		expect(result.actions[0]?.status).toBe("failed");
	});
});
