import { describe, expect, test } from "bun:test";
import { getActiveDependencyHold } from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import { basePreviewConfig, buildCycleContext, freshSnapshots } from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";

describe("runCycle reconcile error guard", () => {
	test("enters dependency_hold with rpc_timeout when reconcile throws timeout error", async () => {
		const db = createTestDb();

		const result = await runCycle(
			buildCycleContext(db, {
				reconcile: async () => {
					throw new Error("RPC call timed out after 15000ms");
				},
				fetchMetrics: async () => freshSnapshots(),
			}),
		);

		expect(result.status).toBe("dependency_hold");
		expect(result.decisionLog.outcome).toBe("dependency_hold");
		const hold = await getActiveDependencyHold(db);
		expect(hold?.reason).toBe("rpc_timeout");
	});

	test("enters dependency_hold with vault_unavailable for non-timeout reconcile errors", async () => {
		const db = createTestDb();

		const result = await runCycle(
			buildCycleContext(db, {
				config: basePreviewConfig,
				reconcile: async () => {
					throw new Error("vault account not found");
				},
			}),
		);

		expect(result.status).toBe("dependency_hold");
		const hold = await getActiveDependencyHold(db);
		expect(hold?.reason).toBe("vault_unavailable");
	});
});
