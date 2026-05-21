import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import { createTestDb } from "../helpers/test-db.ts";
import { makeWalletPosition } from "../helpers/wallet-position.ts";

const now = new Date("2026-05-20T12:00:00.000Z");

const config = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	previewMode: true,
	vaults: [
		{ address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E" },
		{ address: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo" },
		{ address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE" },
	],
	policy: {
		profile: "aggressive",
		minTradeSizeBase: "1",
		minImprovementBps: 0,
		cooldownMs: 0,
		driftBandPct: 0,
	},
});

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

function freshSnapshots() {
	return [
		buildMetricsSnapshot({
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			netApy: 11,
			tvlUsd: 50_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			netApy: 9,
			tvlUsd: 40_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			netApy: 7,
			tvlUsd: 30_000_000,
			capturedAt: now,
			fresh: true,
		}),
	];
}

describe("runCycle reconcile-first ordering", () => {
	test("reconciles before metrics fetch and planning on every cycle", async () => {
		const db = createTestDb();
		const callOrder: string[] = [];

		await runCycle({
			config,
			clients: {
				rpc: {} as never,
				rpcSubscriptions: {} as never,
				timeoutMs: 15_000,
			},
			signer: { address: "wallet" } as never,
			db,
			now,
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
		});

		expect(callOrder.indexOf("reconcile")).toBe(0);
		expect(callOrder.indexOf("metrics")).toBeGreaterThan(callOrder.indexOf("reconcile"));
		if (callOrder.includes("execute")) {
			expect(callOrder.indexOf("execute")).toBeGreaterThan(callOrder.indexOf("metrics"));
		}
	});

	test("uses reconciled position after simulated partial failure state", async () => {
		const db = createTestDb();
		let reconcileCalls = 0;

		const result = await runCycle({
			config,
			clients: {
				rpc: {} as never,
				rpcSubscriptions: {} as never,
				timeoutMs: 15_000,
			},
			signer: { address: "wallet" } as never,
			db,
			now,
			reconcile: async () => {
				reconcileCalls += 1;
				return positionAfterPartial;
			},
			fetchMetrics: async () => freshSnapshots(),
		});

		expect(reconcileCalls).toBe(1);
		const inputs = result.decisionLog.inputs as {
			position?: { tokenBalance?: string };
		};
		expect(inputs.position?.tokenBalance).toBe("250");
	});
});
