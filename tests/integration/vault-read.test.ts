import { describe, test } from "bun:test";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!runIntegration)("KaminoVault metrics read", () => {
	test.skip("Phase 3: on-chain metrics read path", () => {});
});
