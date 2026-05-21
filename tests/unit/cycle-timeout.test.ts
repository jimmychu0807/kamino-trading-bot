import { describe, expect, test } from "bun:test";
import { getActiveExecutionHold, getLatestConsecutiveFailureCount } from "../../src/cycle/hold.ts";
import { runCycle } from "../../src/cycle/runner.ts";
import {
	baseLiveConfig,
	buildCycleContext,
	imbalancedPosition,
	TEST_NOW,
} from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";

async function runPartialFailureCycle(db: ReturnType<typeof createTestDb>, cycleNow: Date) {
	return runCycle(
		buildCycleContext(db, {
			config: baseLiveConfig,
			now: cycleNow,
			reconcile: async () => imbalancedPosition,
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
		}),
	);
}

describe("cycle timeout and consecutive failures", () => {
	test("AbortSignal timeout produces timeout status", async () => {
		const db = createTestDb();
		const controller = new AbortController();
		controller.abort(new DOMException("Cycle aborted", "AbortError"));

		const result = await runCycle(
			buildCycleContext(db, {
				config: baseLiveConfig,
				abortSignal: controller.signal,
				reconcile: async () => {
					throw new Error("should not reach execution after abort");
				},
			}),
		);

		expect(result.status).toBe("timeout");
		expect(result.decisionLog.rationale).toContain("timeout");
	});

	test("consecutive failure counter increments and triggers execution hold at threshold", async () => {
		const db = createTestDb();

		for (let i = 0; i < 3; i += 1) {
			const result = await runPartialFailureCycle(db, new Date(TEST_NOW.getTime() + i * 60_000));
			expect(result.status).toBe("partial");
		}

		expect(await getLatestConsecutiveFailureCount(db)).toBe(3);
		expect(await getActiveExecutionHold(db)).not.toBeNull();
	});
});
