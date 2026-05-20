import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { AppDatabase } from "../../src/db/client.ts";
import * as schema from "../../src/db/schema.ts";

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

export function createTestDb(): AppDatabase {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return db;
}
