import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cycles = sqliteTable(
	"cycles",
	{
		id: text("id").primaryKey(),
		startedAt: text("started_at").notNull(),
		endedAt: text("ended_at"),
		status: text("status").notNull(),
		previewMode: integer("preview_mode", { mode: "boolean" }).notNull(),
		consecutiveFailureCount: integer("consecutive_failure_count")
			.notNull()
			.default(0),
	},
	(table) => [index("cycles_started_at_idx").on(table.startedAt)],
);

export const metricSnapshots = sqliteTable(
	"metric_snapshots",
	{
		id: text("id").primaryKey(),
		cycleId: text("cycle_id").references(() => cycles.id),
		vaultAddress: text("vault_address").notNull(),
		capturedAt: text("captured_at").notNull(),
		payloadJson: text("payload_json").notNull(),
	},
	(table) => [
		index("metric_snapshots_vault_captured_idx").on(
			table.vaultAddress,
			table.capturedAt,
		),
	],
);

export const decisionLogs = sqliteTable("decision_logs", {
	cycleId: text("cycle_id")
		.primaryKey()
		.references(() => cycles.id),
	inputsJson: text("inputs_json").notNull(),
	scoresJson: text("scores_json").notNull(),
	targetsJson: text("targets_json").notNull(),
	actionsJson: text("actions_json").notNull(),
	outcome: text("outcome").notNull(),
	rationale: text("rationale").notNull(),
});

export const rebalanceActions = sqliteTable("rebalance_actions", {
	id: text("id").primaryKey(),
	cycleId: text("cycle_id")
		.notNull()
		.references(() => cycles.id),
	vaultAddress: text("vault_address").notNull(),
	kind: text("kind").notNull(),
	phase: text("phase").notNull(),
	plannedAmount: text("planned_amount").notNull(),
	txSignature: text("tx_signature"),
	status: text("status").notNull(),
	attempts: integer("attempts").notNull().default(0),
	error: text("error"),
});

export const holdStates = sqliteTable(
	"hold_states",
	{
		id: text("id").primaryKey(),
		kind: text("kind").notNull(),
		reason: text("reason").notNull(),
		active: integer("active", { mode: "boolean" }).notNull(),
		since: text("since").notNull(),
		acknowledgedAt: text("acknowledged_at"),
	},
	(table) => [index("hold_states_active_idx").on(table.active)],
);

export const policySnapshots = sqliteTable("policy_snapshots", {
	cycleId: text("cycle_id")
		.primaryKey()
		.references(() => cycles.id),
	policyHash: text("policy_hash").notNull(),
	policyJson: text("policy_json").notNull(),
	createdAt: text("created_at").notNull(),
});
