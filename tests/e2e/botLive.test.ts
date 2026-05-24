import { describe, expect, test } from "bun:test";

describe.skipIf(!process.env.E2E_LIVE)("bot live e2e", () => {
	test("requires E2E_LIVE env to run real transactions", () => {
		expect(process.env.E2E_LIVE).toBeDefined();
	});
});
