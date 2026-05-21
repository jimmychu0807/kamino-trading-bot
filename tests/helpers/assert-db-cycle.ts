import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.ts";
import { cycles, decisionLogs, rebalanceActions } from "../../src/db/schema.ts";

export type DbCycleExpectation = {
	status: string;
	outcome: string;
	minRebalanceActions?: number;
};

export async function assertDbCycle(
	dbPath: string,
	cycleId: string,
	expected: DbCycleExpectation,
): Promise<void> {
	const sqlite = new Database(dbPath, { readonly: true });
	const db = drizzle(sqlite, { schema });

	const cycleRows = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
	const cycle = cycleRows[0];
	if (!cycle) {
		throw new Error(`No cycle row for id ${cycleId}`);
	}
	if (cycle.status !== expected.status) {
		throw new Error(`Expected cycle status ${expected.status}, got ${cycle.status}`);
	}

	const logRows = await db
		.select()
		.from(decisionLogs)
		.where(eq(decisionLogs.cycleId, cycleId))
		.limit(1);
	const log = logRows[0];
	if (!log) {
		throw new Error(`No decision log for cycle ${cycleId}`);
	}
	if (log.outcome !== expected.outcome) {
		throw new Error(`Expected decision outcome ${expected.outcome}, got ${log.outcome}`);
	}

	if (expected.minRebalanceActions !== undefined) {
		const actions = await db
			.select()
			.from(rebalanceActions)
			.where(eq(rebalanceActions.cycleId, cycleId));
		if (actions.length < expected.minRebalanceActions) {
			throw new Error(
				`Expected at least ${expected.minRebalanceActions} rebalance actions, got ${actions.length}`,
			);
		}
	}

	sqlite.close();
}
