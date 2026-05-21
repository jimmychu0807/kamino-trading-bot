import { describe, expect, test } from "bun:test";
import { getActiveDependencyHold } from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import {
	balancedPosition,
	buildCycleContext,
	freshSnapshots,
	TEST_NOW,
	VAULT_A,
} from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";

describe("runCycle APY spike guard", () => {
	test("enters dependency_hold when fresh snapshot has validForTrading false", async () => {
		const db = createTestDb();
		const spikeSnapshot = buildMetricsSnapshot({
			vaultAddress: VAULT_A,
			netApy: 99,
			tvlUsd: 50_000_000,
			capturedAt: TEST_NOW,
			fresh: true,
			validForTrading: false,
		});

		const result = await runCycle(
			buildCycleContext(db, {
				reconcile: async () => balancedPosition,
				fetchMetrics: async () => [
					spikeSnapshot,
					...freshSnapshots().filter((s) => s.vaultAddress !== VAULT_A),
				],
			}),
		);

		expect(result.status).toBe("dependency_hold");
		expect(result.decisionLog.outcome).toBe("dependency_hold");
		const hold = await getActiveDependencyHold(db);
		expect(hold?.reason).toBe("apy_spike");
	});
});
