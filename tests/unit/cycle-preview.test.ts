import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import { loadDecisionLog, runCycle } from "../../src/cycle/runner.ts";
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

/** Concentrated in lowest-APY vault so rebalancing toward targets raises projected yield. */
const position = makeWalletPosition({
	tokenBalance: 0n,
	vaultShares: [
		{
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			shares: 1n,
			valueBase: 50n,
		},
		{
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			shares: 1n,
			valueBase: 50n,
		},
		{
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			shares: 1n,
			valueBase: 900n,
		},
	],
	totalDeployable: 1_000n,
});

function freshSnapshots() {
	return [
		buildMetricsSnapshot({
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			netApy: 12,
			tvlUsd: 50_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			netApy: 10,
			tvlUsd: 40_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			netApy: 8,
			tvlUsd: 30_000_000,
			capturedAt: now,
			fresh: true,
		}),
	];
}

describe("runCycle preview path", () => {
	test("plans legs and persists decision log without executing txs", async () => {
		const db = createTestDb();
		let executeCalled = false;

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
			reconcile: async () => position,
			fetchMetrics: async () => freshSnapshots(),
			executeActions: async () => {
				executeCalled = true;
				return { status: "completed", actions: [] };
			},
		});

		expect(executeCalled).toBe(false);
		expect(result.status).toBe("preview");
		expect(result.actions.length).toBeGreaterThan(0);

		const persisted = await loadDecisionLog(db, result.cycleId);
		expect(persisted).not.toBeNull();
		expect(persisted?.outcome).toBe("preview");
		expect(persisted?.rationale).toContain("Preview mode");
		expect(persisted?.scores).toBeInstanceOf(Array);
		expect((persisted?.scores as unknown[]).length).toBe(3);
	});

	test("applies MAX_ALLOCATION cap to decision log position", async () => {
		const db = createTestDb();
		const uncapped = makeWalletPosition({
			tokenBalance: 50n,
			vaultShares: [
				{
					vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
					shares: 1n,
					valueBase: 90n,
				},
			],
		});

		const result = await runCycle({
			config: { ...config, maxAllocationBase: 100n },
			clients: {
				rpc: {} as never,
				rpcSubscriptions: {} as never,
				timeoutMs: 15_000,
			},
			signer: { address: "wallet" } as never,
			db,
			now,
			reconcile: async () => uncapped,
			fetchMetrics: async () => freshSnapshots(),
		});

		const persisted = await loadDecisionLog(db, result.cycleId);
		const logged = persisted?.inputs as {
			position?: {
				totalOnChain?: string;
				totalDeployable?: string;
				walletBalanceCounted?: string;
			};
		};
		expect(logged.position?.totalOnChain).toBe("140");
		expect(logged.position?.totalDeployable).toBe("100");
		expect(logged.position?.walletBalanceCounted).toBe("10");
	});
});
