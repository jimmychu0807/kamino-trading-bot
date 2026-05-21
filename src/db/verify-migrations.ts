import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DRIZZLE_DIR = resolve(import.meta.dir, "../../drizzle");
const META_DIR = join(DRIZZLE_DIR, "meta");

const INIT_TABLES = [
	"cycles",
	"metric_snapshots",
	"decision_logs",
	"rebalance_actions",
	"hold_states",
	"policy_snapshots",
] as const;

type Journal = {
	entries: { tag: string }[];
};

function snapshotPathForTag(tag: string): string {
	const prefix = tag.split("_")[0];
	return join(META_DIR, `${prefix}_snapshot.json`);
}

function readJournal(): Journal {
	return JSON.parse(readFileSync(join(META_DIR, "_journal.json"), "utf8")) as Journal;
}

/** Latest drizzle/meta snapshot must describe the current schema baseline. */
export function assertLatestSnapshotPopulated(): void {
	const journal = readJournal();
	const last = journal.entries.at(-1);
	if (!last) {
		throw new Error("drizzle/meta/_journal.json has no migration entries");
	}

	const snapshotPath = snapshotPathForTag(last.tag);
	const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
		tables?: Record<string, unknown>;
	};
	const tableCount = Object.keys(snapshot.tables ?? {}).length;

	if (tableCount === 0) {
		throw new Error(
			`${snapshotPath} has no tables. drizzle-kit generate will emit a duplicate full-schema migration and db:migrate will fail. Restore the snapshot from schema or delete bad migrations and regenerate after fixing the snapshot.`,
		);
	}
}

/** Post-0000 SQL must not recreate tables from the init migration. */
export function assertNoDuplicateInitCreates(): void {
	const sqlFiles = readdirSync(DRIZZLE_DIR)
		.filter((name) => name.endsWith(".sql") && name !== "0000_init.sql")
		.sort();

	for (const file of sqlFiles) {
		const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8");
		for (const table of INIT_TABLES) {
			if (sql.includes(`CREATE TABLE \`${table}\``)) {
				throw new Error(
					`${file} recreates table "${table}" (duplicate init). Remove that migration file and journal entry, fix drizzle/meta snapshots, then run db:generate only after editing src/db/schema.ts.`,
				);
			}
		}
	}
}

export function verifyMigrations(): void {
	assertLatestSnapshotPopulated();
	assertNoDuplicateInitCreates();
}

if (import.meta.main) {
	verifyMigrations();
	console.log("Migration metadata OK");
}
