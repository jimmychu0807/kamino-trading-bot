import { describe, test } from "bun:test";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!runIntegration)("deposit/withdraw ix build", () => {
	test.skip("Phase 5: build withdrawIxs / depositIxs without send", () => {});
});
