import "./setup.ts";
import { describe, expect, test } from "bun:test";
import { createRpcClients } from "../../src/chain/rpc.ts";
import { loadRpcUrl } from "../../src/config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";
import { fetchVaultMetricsSnapshot, isMetricsFresh } from "../../src/kamino/metrics.ts";
import { fetchVaultSummary } from "../../src/kamino/vault.ts";

const runIntegration = Bun.env.RUN_INTEGRATION_TESTS === "true";
const integrationUser = Bun.env.INTEGRATION_USER_ADDRESS?.trim();

describe.skipIf(!runIntegration)("Kamino vault metrics (integration)", () => {
	let rpcUrl: string;

	test("loads RPC from environment", () => {
		rpcUrl = loadRpcUrl();
		expect(rpcUrl.startsWith("http")).toBe(true);
	});

	test("fetches normalized metrics snapshot for example vault", async () => {
		const clients = createRpcClients(rpcUrl, 15_000);
		const snapshot = await fetchVaultMetricsSnapshot(clients, EXAMPLE_VAULT_ADDRESSES.allezUsdc, {
			maxAgeMs: 900_000,
		});

		expect(snapshot.vaultAddress).toBe(EXAMPLE_VAULT_ADDRESSES.allezUsdc);
		expect(snapshot.source).toBe("chain");
		expect(snapshot.netApy).toBeGreaterThanOrEqual(0);
		expect(snapshot.tvlUsd).toBeGreaterThan(0);
		expect(snapshot.capturedAt).toBeInstanceOf(Date);
		expect(isMetricsFresh(snapshot, 900_000)).toBe(true);
		expect(Array.isArray(snapshot.reserveWeights)).toBe(true);
	});

	test("legacy fetchVaultSummary still works", async () => {
		if (!integrationUser) {
			throw new Error("INTEGRATION_USER_ADDRESS required for vault integration test");
		}
		const clients = createRpcClients(rpcUrl, 15_000);
		const summary = await fetchVaultSummary(
			clients.rpc,
			EXAMPLE_VAULT_ADDRESSES.allezUsdc,
			integrationUser,
		);

		expect(summary.apys).toBeDefined();
		expect(summary.holdings).toBeDefined();
	});
});
