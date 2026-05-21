import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { alertFromEnv, emitAlert } from "../../src/alerts/emit.ts";

describe("emitAlert", () => {
	let stdoutLines: string[] = [];
	const originalLog = console.log;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		stdoutLines = [];
		console.log = (...args: unknown[]) => {
			stdoutLines.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		console.log = originalLog;
		globalThis.fetch = originalFetch;
	});

	test("logs structured JSON to stdout", () => {
		emitAlert({
			event: "dependency_hold_entered",
			timestamp: "2026-05-20T12:00:00.000Z",
			cycleId: "cycle-1",
			message: "hold entered",
		});

		expect(stdoutLines).toHaveLength(1);
		const parsed = JSON.parse(stdoutLines[0] ?? "{}") as { event: string; cycleId: string };
		expect(parsed.event).toBe("dependency_hold_entered");
		expect(parsed.cycleId).toBe("cycle-1");
	});

	test("posts webhook without throwing on success or failure", async () => {
		let fetchCalls = 0;
		globalThis.fetch = (async () => {
			fetchCalls += 1;
			return new Response("ok", { status: 200 });
		}) as typeof fetch;

		emitAlert(
			{
				event: "tx_leg_failed",
				timestamp: "2026-05-20T12:00:00.000Z",
				message: "leg failed",
			},
			{ webhookUrl: "https://hooks.example/alert" },
		);

		await Bun.sleep(10);
		expect(fetchCalls).toBe(1);

		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;

		expect(() =>
			emitAlert(
				{
					event: "tx_leg_failed",
					timestamp: "2026-05-20T12:00:00.000Z",
					message: "leg failed again",
				},
				{ webhookUrl: "https://hooks.example/alert" },
			),
		).not.toThrow();
	});

	test("alertFromEnv reads ALERT_WEBHOOK_URL from env", async () => {
		let webhookUrl: string | undefined;
		globalThis.fetch = (async (_input, init) => {
			webhookUrl = _input as string;
			expect(init?.method).toBe("POST");
			return new Response("ok", { status: 200 });
		}) as typeof fetch;

		alertFromEnv(
			"rebalance_skipped",
			{ message: "skipped", now: new Date("2026-05-20T12:00:00.000Z") },
			{ ALERT_WEBHOOK_URL: "https://hooks.example/env" },
		);

		await Bun.sleep(10);
		expect(webhookUrl).toBe("https://hooks.example/env");
	});
});
