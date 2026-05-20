import { describe, expect, test } from "bun:test";
import {
	isCycleInFlight,
	resetCycleMutex,
	withCycleMutex,
} from "../../src/cycle/mutex.ts";

describe("cycleInFlight mutex", () => {
	test("skips overlapping invocations", async () => {
		resetCycleMutex();
		let innerRan = false;

		const first = withCycleMutex(async () => {
			expect(isCycleInFlight()).toBe(true);
			await new Promise((r) => setTimeout(r, 20));
			innerRan = true;
			return "ok";
		});

		const second = withCycleMutex(async () => "skipped");

		expect(await second).toBeNull();
		expect(await first).toBe("ok");
		expect(innerRan).toBe(true);
		expect(isCycleInFlight()).toBe(false);
	});
});
