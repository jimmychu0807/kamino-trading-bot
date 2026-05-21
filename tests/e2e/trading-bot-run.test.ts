import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runE2e = Bun.env.RUN_E2E_TESTS === "true";
const e2eSlow = Bun.env.E2E_SLOW === "true";

function countCycleResults(stdout: string): number {
	const ids = [...stdout.matchAll(/"cycleId":\s*"([^"]+)"/g)].map((match) => match[1]);
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

	const testTimeoutMs = e2eSlow ? 60_000 : 30_000;
	const runForSecs = e2eSlow ? "30" : "12";
	const cycleIntervalSecs = e2eSlow ? "10" : "4";

	test(
		`runs preview bot for ${runForSecs}s with ${cycleIntervalSecs}s rebalance interval`,
		async () => {
			const minElapsedMs = e2eSlow ? 28_000 : 10_000;
			const maxElapsedMs = e2eSlow ? 45_000 : 20_000;
			const minCycles = e2eSlow ? 2 : 1;
			const maxCycles = e2eSlow ? 5 : 4;

			tempDir = await mkdtemp(join(tmpdir(), "kamino-bot-e2e-"));
			dbPath = join(tempDir, "bot.sqlite");

			const projectRoot = join(import.meta.dir, "../..");
			const start = Date.now();

			proc = Bun.spawn({
				cmd: ["bun", "run", "src/cli.ts", "run", runForSecs, cycleIntervalSecs],
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

			if (stdout.trim().length > 0) console.log("  stdout:", stdout.trim());
			if (stderr.trim().length > 0) console.log("  stderr:", stderr);

			expect(exitCode).toBe(0);
			expect(elapsedMs).toBeGreaterThanOrEqual(minElapsedMs);
			expect(elapsedMs).toBeLessThan(maxElapsedMs);
			expect(stdout).toContain('"event":"bot_start"');
			expect(stdout).toContain('"previewMode":true');
			expect(stdout).toContain('"event":"bot_stop"');
			expect(stderr).not.toContain("CLI error:");

			const cycleCount = countCycleResults(stdout);
			expect(cycleCount).toBeGreaterThanOrEqual(minCycles);
			expect(cycleCount).toBeLessThanOrEqual(maxCycles);
		},
		testTimeoutMs,
	);
});
