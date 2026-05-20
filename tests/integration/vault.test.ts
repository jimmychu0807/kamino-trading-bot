import { describe, expect, test } from "bun:test";
import { createRpcClients } from "../../src/chain/rpc.ts";
import { loadRpcUrl } from "../../src/config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";
import { fetchVaultSummary } from "../../src/kamino/vault.ts";

const runIntegration = Bun.env.RUN_INTEGRATION_TESTS === "true";
const integrationUser = Bun.env.INTEGRATION_USER_ADDRESS?.trim();

describe.skipIf(!runIntegration)("Kamino vault (integration)", () => {
	let rpcUrl: string;

	test("loads RPC from environment", () => {
		rpcUrl = loadRpcUrl();
		expect(rpcUrl.startsWith("http")).toBe(true);
	});

	test("fetches vault summary for example Allez USDC vault", async () => {
		if (!integrationUser) {
			throw new Error(
				"INTEGRATION_USER_ADDRESS required for vault integration test",
			);
		}
		const clients = createRpcClients(rpcUrl, 15_000);
		const summary = await fetchVaultSummary(
			clients.rpc,
			EXAMPLE_VAULT_ADDRESSES.allezUsdc,
			integrationUser,
		);

		const numericString = /^\d+(\.\d+)?$/;
		expect(summary.exchangeRate).toMatch(numericString);
		expect(summary.shares).toMatch(numericString);
		expect(summary.value).toMatch(numericString);
		expect(summary.apys).toBeDefined();
		expect(summary.holdings).toBeDefined();
	});
});
