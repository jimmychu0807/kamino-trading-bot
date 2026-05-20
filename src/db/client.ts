import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type AppDatabase = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
	const sqlite = new Database(databaseUrl, { create: true });
	return drizzle(sqlite, { schema });
}

export function getDefaultDatabaseUrl(
	env: Record<string, string | undefined> = process.env,
): string {
	return env.DATABASE_URL?.trim() || "./data/bot.sqlite";
}
