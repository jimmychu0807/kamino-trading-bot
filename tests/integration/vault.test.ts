import { describe, expect, test } from "bun:test";
import { loadRpcUrl } from "../../src/config.ts";
import { DEFAULT_PROD_USER, VAULT_ADDRESSES } from "../../src/constants.ts";
import { fetchVaultSummary } from "../../src/vault.ts";

const runIntegration = Bun.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!runIntegration)("Kamino vault (integration)", () => {
	let rpcUrl: string;

	test("loads RPC from environment", () => {
		rpcUrl = loadRpcUrl();
		expect(rpcUrl.startsWith("http")).toBe(true);
	});

	test("fetches vault summary for Allez USDS vault", async () => {
		const summary = await fetchVaultSummary(
			rpcUrl,
			VAULT_ADDRESSES.allezUsds,
			DEFAULT_PROD_USER,
		);

		expect(summary.exchangeRate).toMatch(/^\d+$/);
		expect(summary.shares).toMatch(/^\d+$/);
		expect(summary.value).toMatch(/^\d+$/);
		expect(summary.apys).toBeDefined();
		expect(summary.holdings).toBeDefined();
	});
});
