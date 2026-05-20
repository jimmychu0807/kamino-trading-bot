import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.ts";
import { cycles, holdStates } from "../db/schema.ts";

export type HoldKind = "dependency" | "execution";

export type ActiveHold = {
	id: string;
	kind: HoldKind;
	reason: string;
	since: Date;
	acknowledgedAt: Date | null;
};

function rowToActiveHold(row: typeof holdStates.$inferSelect): ActiveHold {
	return {
		id: row.id,
		kind: row.kind as HoldKind,
		reason: row.reason,
		since: new Date(row.since),
		acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt) : null,
	};
}

export async function getActiveHold(db: AppDatabase, kind: HoldKind): Promise<ActiveHold | null> {
	const rows = await db
		.select()
		.from(holdStates)
		.where(and(eq(holdStates.active, true), eq(holdStates.kind, kind)))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	if (kind === "execution" && row.acknowledgedAt) {
		return null;
	}
	return rowToActiveHold(row);
}

export async function getActiveDependencyHold(db: AppDatabase): Promise<ActiveHold | null> {
	return getActiveHold(db, "dependency");
}

export async function getActiveExecutionHold(db: AppDatabase): Promise<ActiveHold | null> {
	return getActiveHold(db, "execution");
}

export async function enterHold(
	db: AppDatabase,
	params: {
		kind: HoldKind;
		reason: string;
		now: Date;
	},
): Promise<ActiveHold> {
	await db
		.update(holdStates)
		.set({ active: false })
		.where(and(eq(holdStates.active, true), eq(holdStates.kind, params.kind)));

	const hold: ActiveHold = {
		id: crypto.randomUUID(),
		kind: params.kind,
		reason: params.reason,
		since: params.now,
		acknowledgedAt: null,
	};

	await db.insert(holdStates).values({
		id: hold.id,
		kind: hold.kind,
		reason: hold.reason,
		active: true,
		since: hold.since.toISOString(),
		acknowledgedAt: null,
	});

	return hold;
}

export async function enterDependencyHold(
	db: AppDatabase,
	params: { reason: string; now: Date },
): Promise<ActiveHold> {
	const existing = await getActiveDependencyHold(db);
	if (existing) {
		return existing;
	}
	return enterHold(db, { kind: "dependency", ...params });
}

export async function enterExecutionHold(
	db: AppDatabase,
	params: { reason: string; now: Date },
): Promise<ActiveHold> {
	const existing = await getActiveExecutionHold(db);
	if (existing) {
		return existing;
	}
	return enterHold(db, { kind: "execution", ...params });
}

export async function clearDependencyHold(db: AppDatabase): Promise<boolean> {
	const active = await getActiveDependencyHold(db);
	if (!active) return false;

	await db.update(holdStates).set({ active: false }).where(eq(holdStates.id, active.id));

	return true;
}

export async function acknowledgeExecutionHold(
	db: AppDatabase,
	now: Date = new Date(),
): Promise<boolean> {
	const active = await getActiveExecutionHold(db);
	if (!active) return false;

	await db
		.update(holdStates)
		.set({
			active: false,
			acknowledgedAt: now.toISOString(),
		})
		.where(eq(holdStates.id, active.id));

	return true;
}

/** Rolling consecutive-failure count from the most recently finished cycle. */
export async function getLatestConsecutiveFailureCount(db: AppDatabase): Promise<number> {
	const rows = await db
		.select({
			consecutiveFailureCount: cycles.consecutiveFailureCount,
			endedAt: cycles.endedAt,
		})
		.from(cycles)
		.orderBy(desc(cycles.startedAt))
		.limit(10);

	for (const row of rows) {
		if (row.endedAt !== null) {
			return row.consecutiveFailureCount;
		}
	}

	return 0;
}

export function nextConsecutiveFailureCount(previousCount: number, hadFailedTx: boolean): number {
	if (!hadFailedTx) return 0;
	return previousCount + 1;
}
