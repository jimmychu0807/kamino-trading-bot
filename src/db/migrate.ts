import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { getDefaultDatabaseUrl } from "./client.ts";

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

export function runMigrations(databaseUrl = getDefaultDatabaseUrl()): void {
	const absolutePath = resolve(databaseUrl);
	mkdirSync(dirname(absolutePath), { recursive: true });

	const sqlite = new Database(absolutePath, { create: true });
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder });
}

if (import.meta.main) {
	runMigrations();
	console.log(`Migrations applied to ${resolve(getDefaultDatabaseUrl())}`);
}
