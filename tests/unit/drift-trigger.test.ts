import { describe, expect, test } from "bun:test";
import { parseOperatorConfig } from "../../src/config/schema.ts";
import { pollDriftOnce, startDriftTrigger } from "../../src/cycle/drift-trigger.ts";
import { resetCycleMutex, withCycleMutex } from "../../src/cycle/mutex.ts";
import type { CycleResult } from "../../src/cycle/runner.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import { createTestDb } from "../helpers/test-db.ts";
import { makeWalletPosition } from "../helpers/wallet-position.ts";

const now = new Date("2026-05-20T12:00:00.000Z");

const position = makeWalletPosition({
	tokenBalance: 0n,
	vaultShares: [
		{
			vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
			shares: 1n,
			valueBase: 900n,
		},
		{
			vaultAddress: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
			shares: 1n,
			valueBase: 50n,
		},
		{
			vaultAddress: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
			shares: 1n,
			valueBase: 50n,
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

describe("drift trigger", () => {
	test("disabled drift trigger is a no-op", () => {
		const db = createTestDb();
		const config = parseOperatorConfig({
			solanaRpc: "https://rpc.example.com",
			privateKey: "5HueCGUQU5b",
			driftTriggerEnabled: false,
			vaults: [
				{ address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E" },
				{ address: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo" },
				{ address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE" },
			],
			policy: { profile: "balanced", minTradeSizeBase: "1" },
		});

		const handle = startDriftTrigger({
			config,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
		});

		expect(handle.stop).toBeInstanceOf(Function);
		handle.stop();
	});

	test("invokes runCycle when drift exceeds band", async () => {
		const db = createTestDb();
		let runCycleCalls = 0;

		const config = parseOperatorConfig({
			solanaRpc: "https://rpc.example.com",
			privateKey: "5HueCGUQU5b",
			driftTriggerEnabled: true,
			driftPollIntervalMs: 60_000,
			vaults: [
				{ address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E" },
				{ address: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo" },
				{ address: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE" },
			],
			policy: {
				profile: "aggressive",
				minTradeSizeBase: "1",
				driftBandPct: 2,
			},
		});

		const ctx = {
			config,
			clients: { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			signer: { address: "wallet" } as never,
			db,
		};

		const result = await pollDriftOnce(ctx, {
			reconcile: async () => position,
			fetchMetrics: async () => freshSnapshots(),
			runCycleFn: async () => {
				runCycleCalls += 1;
				return {
					cycleId: "drift-cycle",
					status: "preview",
					decisionLog: {
						cycleId: "drift-cycle",
						inputs: {},
						scores: [],
						targets: [],
						actions: [],
						outcome: "preview",
						rationale: "drift triggered",
					},
					actions: [],
					hold: null,
				} satisfies CycleResult;
			},
		});

		expect(runCycleCalls).toBe(1);
		expect(result?.cycleId).toBe("drift-cycle");
	});

	test("withCycleMutex skips overlapping drift poll when cron cycle in flight", async () => {
		resetCycleMutex();

		const first = withCycleMutex(async () => {
			await Bun.sleep(50);
			return "first";
		});
		const second = withCycleMutex(async () => "second");

		expect(await second).toBeNull();
		expect(await first).toBe("first");
	});
});
