import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import { getActiveExecutionHold, getLatestConsecutiveFailureCount } from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import { createTestDb } from "../helpers/test-db.ts";
import { makeWalletPosition } from "../helpers/wallet-position.ts";

const now = new Date("2026-05-20T12:00:00.000Z");

const liveConfig = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	previewMode: false,
	consecutiveFailureThreshold: 3,
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

async function runPartialFailureCycle(db: ReturnType<typeof createTestDb>, cycleNow: Date) {
	return runCycle({
		config: liveConfig,
		clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
		signer: { address: "wallet" } as never,
		db,
		now: cycleNow,
		alertEnv: {},
		reconcile: async () => position,
		fetchMetrics: async () => freshSnapshots(),
		executeActions: async ({ actions }) => ({
			status: "partial" as const,
			actions: actions.map((action, index) => ({
				...action,
				status: index === 0 ? ("failed" as const) : ("confirmed" as const),
				signature: index === 0 ? null : ("sig" as never),
				attempts: 1,
				error: index === 0 ? "simulated failure" : undefined,
			})),
		}),
	});
}

describe("cycle timeout and consecutive failures", () => {
	test("AbortSignal timeout produces timeout status", async () => {
		const db = createTestDb();
		const controller = new AbortController();
		controller.abort(new DOMException("Cycle aborted", "AbortError"));

		const result = await runCycle({
			config: liveConfig,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
			now,
			abortSignal: controller.signal,
			alertEnv: {},
			reconcile: async () => {
				throw new Error("should not reach execution after abort");
			},
		});

		expect(result.status).toBe("timeout");
		expect(result.decisionLog.rationale).toContain("timeout");
	});

	test("consecutive failure counter increments and triggers execution hold at threshold", async () => {
		const db = createTestDb();

		for (let i = 0; i < 3; i += 1) {
			const result = await runPartialFailureCycle(db, new Date(now.getTime() + i * 60_000));
			expect(result.status).toBe("partial");
		}

		expect(await getLatestConsecutiveFailureCount(db)).toBe(3);
		expect(await getActiveExecutionHold(db)).not.toBeNull();
	});
});
