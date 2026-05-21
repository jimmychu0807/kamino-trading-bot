import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { getDefaultDatabaseUrl } from "./client.ts";

const SQLITE_SIDEcar_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

export function clearDatabase(databaseUrl = getDefaultDatabaseUrl()): void {
	const absolutePath = resolve(databaseUrl);
	let removed = 0;

	for (const suffix of SQLITE_SIDEcar_SUFFIXES) {
		const path = `${absolutePath}${suffix}`;
		if (!existsSync(path)) continue;
		unlinkSync(path);
		removed++;
		console.log(`Removed ${path}`);
	}

	if (removed === 0) {
		console.log(`No database files found at ${absolutePath}`);
		return;
	}

	console.log(
		`Cleared ${removed} file(s). Run \`bun run db:migrate\` (or start the bot) to recreate the schema.`,
	);
}

if (import.meta.main) {
	clearDatabase();
}
