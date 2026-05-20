import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import { holdStates } from "../db/schema.ts";

export type ActiveHold = {
	id: string;
	kind: "dependency" | "execution";
	reason: string;
	since: Date;
	acknowledgedAt: Date | null;
};

export async function getActiveExecutionHold(db: AppDatabase): Promise<ActiveHold | null> {
	const rows = await db
		.select()
		.from(holdStates)
		.where(and(eq(holdStates.active, true), eq(holdStates.kind, "execution")))
		.limit(1);

	const row = rows[0];
	if (!row || row.acknowledgedAt) {
		return null;
	}

	return {
		id: row.id,
		kind: "execution",
		reason: row.reason,
		since: new Date(row.since),
		acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null,
	};
}
