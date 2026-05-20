import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runE2e = Bun.env.RUN_E2E_TESTS === "true";

function countCycleResults(stdout: string): number {
	const ids = [
		...stdout.matchAll(/"cycleId":\s*"([^"]+)"/g),
	].map((match) => match[1]);
	return new Set(ids).size;
}

describe.skipIf(!runE2e)("trading bot CLI run (e2e)", () => {
	let tempDir: string;
	let dbPath: string;
	let proc: ReturnType<typeof Bun.spawn> | undefined;

	afterAll(async () => {
		proc?.kill();
		await proc?.exited.catch(() => undefined);
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("runs preview bot for 30s with 10s rebalance interval", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "kamino-bot-e2e-"));
		dbPath = join(tempDir, "bot.sqlite");

		const projectRoot = join(import.meta.dir, "../..");
		const start = Date.now();

		proc = Bun.spawn({
			cmd: ["bun", "run", "src/cli.ts", "run", "30", "10"],
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
		const elapsedMs = Date.now() - start;

		expect(exitCode).toBe(0);
		expect(elapsedMs).toBeGreaterThanOrEqual(28_000);
		expect(elapsedMs).toBeLessThan(45_000);
		expect(stdout).toContain('"event":"bot_start"');
		expect(stdout).toContain('"previewMode":true');
		expect(stdout).toContain('"event":"bot_stop"');
		expect(stderr).not.toContain("CLI error:");

		const cycleCount = countCycleResults(stdout);
		expect(cycleCount).toBeGreaterThanOrEqual(2);
		expect(cycleCount).toBeLessThanOrEqual(5);
	}, 60_000);
});
