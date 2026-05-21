import { describe, expect, test } from "bun:test";
import {
	acknowledgeExecutionHold,
	clearDependencyHold,
	enterDependencyHold,
	enterExecutionHold,
	getActiveDependencyHold,
	getActiveExecutionHold,
} from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import {
	balancedPosition,
	basePreviewConfig,
	buildCycleContext,
	freshSnapshots,
	TEST_NOW,
} from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";

describe("hold state machine", () => {
	test("dependency hold auto-resumes when metrics recover", async () => {
		const db = createTestDb();
		await enterDependencyHold(db, { reason: "stale_metrics", now: TEST_NOW });

		const staleResult = await runCycle(
			buildCycleContext(db, {
				reconcile: async () => balancedPosition,
				fetchMetrics: async () =>
					freshSnapshots().map((snapshot, index) =>
						index === 0 ? { ...snapshot, fresh: false } : snapshot,
					),
			}),
		);

		expect(staleResult.status).toBe("dependency_hold");
		expect(await getActiveDependencyHold(db)).not.toBeNull();

		const recoveredResult = await runCycle(
			buildCycleContext(db, {
				now: new Date(TEST_NOW.getTime() + 60_000),
				reconcile: async () => balancedPosition,
			}),
		);

		expect(recoveredResult.status).not.toBe("dependency_hold");
		expect(await getActiveDependencyHold(db)).toBeNull();
	});

	test("execution hold requires operator ack before trading resumes", async () => {
		const db = createTestDb();
		await enterExecutionHold(db, { reason: "tx_failures", now: TEST_NOW });

		const blocked = await runCycle(
			buildCycleContext(db, {
				config: { ...basePreviewConfig, previewMode: false },
				reconcile: async () => balancedPosition,
			}),
		);

		expect(blocked.status).toBe("execution_hold");
		expect(await getActiveExecutionHold(db)).not.toBeNull();

		const acked = await acknowledgeExecutionHold(db, TEST_NOW);
		expect(acked).toBe(true);
		expect(await getActiveExecutionHold(db)).toBeNull();

		const resumed = await runCycle(
			buildCycleContext(db, {
				now: new Date(TEST_NOW.getTime() + 120_000),
				reconcile: async () => balancedPosition,
			}),
		);

		expect(resumed.status).not.toBe("execution_hold");
	});

	test("clearDependencyHold is idempotent when no active hold", async () => {
		const db = createTestDb();
		expect(await clearDependencyHold(db)).toBe(false);
	});
});
