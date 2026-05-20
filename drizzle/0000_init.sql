CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`status` text NOT NULL,
	`preview_mode` integer NOT NULL,
	`consecutive_failure_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cycles_started_at_idx` ON `cycles` (`started_at`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text,
	`vault_address` text NOT NULL,
	`captured_at` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `metric_snapshots_vault_captured_idx` ON `metric_snapshots` (`vault_address`,`captured_at`);--> statement-breakpoint
CREATE TABLE `decision_logs` (
	`cycle_id` text PRIMARY KEY NOT NULL,
	`inputs_json` text NOT NULL,
	`scores_json` text NOT NULL,
	`targets_json` text NOT NULL,
	`actions_json` text NOT NULL,
	`outcome` text NOT NULL,
	`rationale` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rebalance_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`vault_address` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`planned_amount` text NOT NULL,
	`tx_signature` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hold_states` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer NOT NULL,
	`since` text NOT NULL,
	`acknowledged_at` text
);
--> statement-breakpoint
CREATE INDEX `hold_states_active_idx` ON `hold_states` (`active`);--> statement-breakpoint
CREATE TABLE `policy_snapshots` (
	`cycle_id` text PRIMARY KEY NOT NULL,
	`policy_hash` text NOT NULL,
	`policy_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
