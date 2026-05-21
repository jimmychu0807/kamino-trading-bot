import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDbCycle } from "../helpers/assert-db-cycle.ts";
import { parseCliCycleStdout } from "../helpers/parse-cli-cycle.ts";

const runE2e = Bun.env.RUN_E2E_TESTS === "true";

describe.skipIf(!runE2e)("cli cycle (e2e)", () => {
	let tempDir: string;
	let dbPath: string;

	afterAll(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("runs single preview cycle and persists SQLite rows", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "kamino-cli-cycle-e2e-"));
		dbPath = join(tempDir, "bot.sqlite");
		const projectRoot = join(import.meta.dir, "../..");

		const proc = Bun.spawn({
			cmd: ["bun", "run", "src/cli.ts", "cycle"],
			cwd: projectRoot,
			env: {
				...process.env,
				PREVIEW_MODE: "true",
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

		const parsed = parseCliCycleStdout(stdout);
		expect(parsed.cycleId).toBeTruthy();
		expect(parsed.status).toBeTruthy();
		expect(parsed.outcome).toBeTruthy();

		await assertDbCycle(dbPath, parsed.cycleId, {
			status: parsed.status,
			outcome: parsed.outcome,
		});
	}, 120_000);
});
