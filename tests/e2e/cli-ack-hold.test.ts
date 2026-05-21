import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterExecutionHold } from "../../src/cycle/hold.ts";
import { createDb } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";

const runE2e = Bun.env.RUN_E2E_TESTS === "true";

describe.skipIf(!runE2e)("cli ack-hold (e2e)", () => {
	let tempDir: string;
	let dbPath: string;

	afterAll(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("ack-hold clears seeded execution hold", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "kamino-cli-ack-e2e-"));
		dbPath = join(tempDir, "bot.sqlite");
		const projectRoot = join(import.meta.dir, "../..");

		runMigrations(dbPath);
		const db = createDb(dbPath);
		await enterExecutionHold(db, {
			reason: "tx_failures",
			now: new Date("2026-05-20T12:00:00.000Z"),
		});

		const proc = Bun.spawn({
			cmd: ["bun", "run", "src/cli.ts", "ack-hold"],
			cwd: projectRoot,
			env: {
				...process.env,
				DATABASE_URL: dbPath,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			proc.stdout instanceof ReadableStream ? proc.stdout.text() : Promise.resolve(""),
			proc.stderr instanceof ReadableStream ? proc.stderr.text() : Promise.resolve(""),
		]);

		if (stdout.trim().length > 0) console.log("  stdout:", stdout.trim());
		if (stderr.trim().length > 0) console.log("  stderr:", stderr);

		expect(exitCode).toBe(0);
		expect(stderr).not.toContain("CLI error:");
		const parsed = JSON.parse(stdout.trim()) as { event: string; acknowledged: boolean };
		expect(parsed.event).toBe("execution_hold_acknowledged");
		expect(parsed.acknowledged).toBe(true);
	});
});
