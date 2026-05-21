import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runCycle } from "../../src/cycle/runner.ts";
import { rebalanceActions } from "../../src/db/schema.ts";
import {
	baseLiveConfig,
	buildCycleContext,
	imbalancedPosition,
} from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";

describe("runCycle live success path", () => {
	test("persists confirmed rebalance actions when execution completes", async () => {
		const db = createTestDb();

		const result = await runCycle(
			buildCycleContext(db, {
				config: baseLiveConfig,
				reconcile: async () => imbalancedPosition,
				executeActions: async ({ actions }) => ({
					status: "completed" as const,
					actions: actions.map((action) => ({
						...action,
						status: "confirmed" as const,
						signature: "sig-confirmed" as never,
						attempts: 1,
					})),
				}),
			}),
		);

		expect(result.status).toBe("completed");
		expect(result.decisionLog.outcome).toBe("completed");

		const persisted = await db
			.select()
			.from(rebalanceActions)
			.where(eq(rebalanceActions.cycleId, result.cycleId));
		expect(persisted.length).toBeGreaterThan(0);
		expect(persisted.every((row) => row.status === "confirmed")).toBe(true);
	});
});
