import { defineConfig } from "drizzle-kit";

// generate diffs src/db/schema.ts against drizzle/meta/*_snapshot.json (not the .sqlite file).
// See README "Database migrations" before running db:generate.

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "./data/bot.sqlite",
	},
});
