import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "./client.ts";
import { cycles, decisionLogs, metricSnapshots, rebalanceActions } from "./schema.ts";

export type DecisionLogInput = {
	cycleId: string;
	inputs: unknown;
	scores: unknown;
	targets: unknown;
	actions: unknown;
	outcome: string;
	rationale: string;
};

function jsonStringify(value: unknown): string {
	return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val));
}

export type PersistedRebalanceAction = {
	id: string;
	cycleId: string;
	vaultAddress: string;
	kind: string;
	phase: string;
	plannedAmount: string;
	txSignature: string | null;
	status: string;
	attempts: number;
	error: string | null;
};

export async function insertCycle(
	db: AppDatabase,
	params: {
		cycleId: string;
		startedAt: Date;
		previewMode: boolean;
	},
): Promise<void> {
	await db.insert(cycles).values({
		id: params.cycleId,
		startedAt: params.startedAt.toISOString(),
		status: "running",
		previewMode: params.previewMode,
		consecutiveFailureCount: 0,
	});
}

export async function finishCycle(
	db: AppDatabase,
	params: {
		cycleId: string;
		status: string;
		endedAt: Date;
		consecutiveFailureCount?: number;
	},
): Promise<void> {
	await db
		.update(cycles)
		.set({
			status: params.status,
			endedAt: params.endedAt.toISOString(),
			...(params.consecutiveFailureCount !== undefined
				? { consecutiveFailureCount: params.consecutiveFailureCount }
				: {}),
		})
		.where(eq(cycles.id, params.cycleId));
}

export async function writeDecisionLog(db: AppDatabase, log: DecisionLogInput): Promise<void> {
	await db
		.insert(decisionLogs)
		.values({
			cycleId: log.cycleId,
			inputsJson: jsonStringify(log.inputs),
			scoresJson: jsonStringify(log.scores),
			targetsJson: jsonStringify(log.targets),
			actionsJson: jsonStringify(log.actions),
			outcome: log.outcome,
			rationale: log.rationale,
		})
		.onConflictDoUpdate({
			target: decisionLogs.cycleId,
			set: {
				inputsJson: jsonStringify(log.inputs),
				scoresJson: jsonStringify(log.scores),
				targetsJson: jsonStringify(log.targets),
				actionsJson: jsonStringify(log.actions),
				outcome: log.outcome,
				rationale: log.rationale,
			},
		});
}

export async function writeMetricSnapshots(
	db: AppDatabase,
	params: {
		cycleId: string;
		snapshots: { vaultAddress: string; capturedAt: Date; payload: unknown }[];
	},
): Promise<void> {
	if (params.snapshots.length === 0) return;

	await db.insert(metricSnapshots).values(
		params.snapshots.map((snapshot) => ({
			id: crypto.randomUUID(),
			cycleId: params.cycleId,
			vaultAddress: snapshot.vaultAddress,
			capturedAt: snapshot.capturedAt.toISOString(),
			payloadJson: jsonStringify(snapshot.payload),
		})),
	);
}

export async function writeRebalanceActions(
	db: AppDatabase,
	actions: PersistedRebalanceAction[],
): Promise<void> {
	if (actions.length === 0) return;
	await db.insert(rebalanceActions).values(actions);
}

export async function getLastCompletedRebalanceAt(db: AppDatabase): Promise<Date | null> {
	const rows = await db
		.select({ endedAt: cycles.endedAt })
		.from(cycles)
		.where(eq(cycles.status, "completed"))
		.orderBy(desc(cycles.endedAt))
		.limit(1);

	const endedAt = rows[0]?.endedAt;
	return endedAt ? new Date(endedAt) : null;
}
