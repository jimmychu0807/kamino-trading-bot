import { describe, expect, test } from "bun:test";
import { runCycle } from "../../src/cycle/runner.ts";
import { buildCycleContext, freshSnapshots } from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";
import { makeWalletPosition } from "../helpers/wallet-position.ts";

const positionAfterPartial = makeWalletPosition({
	tokenBalance: 250n,
	vaultShares: [
		{
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			shares: 1n,
			valueBase: 500n,
		},
		{
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			shares: 1n,
			valueBase: 150n,
		},
		{
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			shares: 1n,
			valueBase: 100n,
		},
	],
	totalDeployable: 1_000n,
});

describe("runCycle reconcile-first ordering", () => {
	test("reconciles before metrics fetch and planning on every cycle", async () => {
		const db = createTestDb();
		const callOrder: string[] = [];

		await runCycle(
			buildCycleContext(db, {
				reconcile: async () => {
					callOrder.push("reconcile");
					return positionAfterPartial;
				},
				fetchMetrics: async () => {
					callOrder.push("metrics");
					return freshSnapshots();
				},
				executeActions: async () => {
					callOrder.push("execute");
					return { status: "completed", actions: [] };
				},
			}),
		);

		expect(callOrder.indexOf("reconcile")).toBe(0);
		expect(callOrder.indexOf("metrics")).toBeGreaterThan(callOrder.indexOf("reconcile"));
		if (callOrder.includes("execute")) {
			expect(callOrder.indexOf("execute")).toBeGreaterThan(callOrder.indexOf("metrics"));
		}
	});

	test("uses reconciled position after simulated partial failure state", async () => {
		const db = createTestDb();
		let reconcileCalls = 0;

		const result = await runCycle(
			buildCycleContext(db, {
				reconcile: async () => {
					reconcileCalls += 1;
					return positionAfterPartial;
				},
			}),
		);

		expect(reconcileCalls).toBe(1);
		const inputs = result.decisionLog.inputs as {
			position?: { tokenBalance?: string };
		};
		expect(inputs.position?.tokenBalance).toBe("250");
	});
});
