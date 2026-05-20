import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import {
	acknowledgeExecutionHold,
	clearDependencyHold,
	enterDependencyHold,
	enterExecutionHold,
	getActiveDependencyHold,
	getActiveExecutionHold,
} from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import type { WalletPosition } from "../../src/kamino/reconcile.ts";
import { createTestDb } from "../helpers/test-db.ts";

const now = new Date("2026-05-20T12:00:00.000Z");

const baseConfig = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	previewMode: true,
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

const position: WalletPosition = {
	walletAddress: "wallet",
	tokenBalance: 0n,
	vaultShares: [
		{
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			shares: 1n,
			valueBase: 500n,
		},
		{
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			shares: 1n,
			valueBase: 250n,
		},
		{
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			shares: 1n,
			valueBase: 250n,
		},
	],
	totalDeployable: 1_000n,
};

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

describe("hold state machine", () => {
	test("dependency hold auto-resumes when metrics recover", async () => {
		const db = createTestDb();
		await enterDependencyHold(db, { reason: "stale_metrics", now });

		const staleResult = await runCycle({
			config: baseConfig,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
			now,
			alertEnv: {},
			reconcile: async () => position,
			fetchMetrics: async () =>
				freshSnapshots().map((snapshot, index) =>
					index === 0 ? { ...snapshot, fresh: false } : snapshot,
				),
		});

		expect(staleResult.status).toBe("dependency_hold");
		expect(await getActiveDependencyHold(db)).not.toBeNull();

		const recoveredResult = await runCycle({
			config: baseConfig,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
			now: new Date(now.getTime() + 60_000),
			alertEnv: {},
			reconcile: async () => position,
			fetchMetrics: async () => freshSnapshots(),
		});

		expect(recoveredResult.status).not.toBe("dependency_hold");
		expect(await getActiveDependencyHold(db)).toBeNull();
	});

	test("execution hold requires operator ack before trading resumes", async () => {
		const db = createTestDb();
		await enterExecutionHold(db, { reason: "tx_failures", now });

		const blocked = await runCycle({
			config: { ...baseConfig, previewMode: false },
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
			now,
			alertEnv: {},
			reconcile: async () => position,
			fetchMetrics: async () => freshSnapshots(),
		});

		expect(blocked.status).toBe("execution_hold");
		expect(await getActiveExecutionHold(db)).not.toBeNull();

		const acked = await acknowledgeExecutionHold(db, now);
		expect(acked).toBe(true);
		expect(await getActiveExecutionHold(db)).toBeNull();

		const resumed = await runCycle({
			config: baseConfig,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
			now: new Date(now.getTime() + 120_000),
			alertEnv: {},
			reconcile: async () => position,
			fetchMetrics: async () => freshSnapshots(),
		});

		expect(resumed.status).not.toBe("execution_hold");
	});

	test("clearDependencyHold is idempotent when no active hold", async () => {
		const db = createTestDb();
		expect(await clearDependencyHold(db)).toBe(false);
	});
});
