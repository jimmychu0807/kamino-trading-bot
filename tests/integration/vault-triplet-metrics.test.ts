import "./setup.ts";
import { describe, expect, test } from "bun:test";
import { createRpcClients } from "../../src/chain/rpc.ts";
import { loadRpcUrl } from "../../src/config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";
import { fetchVaultMetricsSnapshots } from "../../src/kamino/metrics.ts";

const runIntegration = Bun.env.RUN_INTEGRATION_TESTS === "true";

const triplet = [
	EXAMPLE_VAULT_ADDRESSES.steakhouseUsdc,
	EXAMPLE_VAULT_ADDRESSES.allezUsdc,
	EXAMPLE_VAULT_ADDRESSES.elementalUsdg,
];

describe.skipIf(!runIntegration)("vault triplet metrics (integration)", () => {
	test("fetchVaultMetricsSnapshots returns fresh snapshots for all three vaults", async () => {
		const rpcUrl = loadRpcUrl();
		const clients = createRpcClients(rpcUrl, 15_000);
		const snapshots = await fetchVaultMetricsSnapshots(clients, triplet, {
			maxAgeMs: 900_000,
		});

		expect(snapshots).toHaveLength(3);
		expect(snapshots.every((s) => s.fresh)).toBe(true);
		expect(snapshots.every((s) => s.tvlUsd > 0)).toBe(true);
		expect(new Set(snapshots.map((s) => s.vaultAddress))).toEqual(new Set(triplet));
	});
});
