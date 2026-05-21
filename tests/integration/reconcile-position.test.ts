import "./setup.ts";
import { describe, expect, test } from "bun:test";
import { createRpcClients } from "../../src/chain/rpc.ts";
import { loadRpcUrl } from "../../src/config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";
import { reconcilePositions } from "../../src/kamino/reconcile.ts";

const runIntegration = Bun.env.RUN_INTEGRATION_TESTS === "true";
const integrationUser = Bun.env.INTEGRATION_USER_ADDRESS?.trim();

const triplet = [
	EXAMPLE_VAULT_ADDRESSES.steakhouseUsdc,
	EXAMPLE_VAULT_ADDRESSES.allezUsdc,
	EXAMPLE_VAULT_ADDRESSES.elementalUsdg,
];

describe.skipIf(!runIntegration)("reconcilePositions (integration)", () => {
	test("reconciles wallet position across three vaults", async () => {
		if (!integrationUser) {
			throw new Error("INTEGRATION_USER_ADDRESS required for reconcile integration test");
		}

		const rpcUrl = loadRpcUrl();
		const clients = createRpcClients(rpcUrl, 15_000);
		const position = await reconcilePositions({
			clients,
			walletAddress: integrationUser,
			vaultAddresses: triplet,
		});

		expect(position.walletAddress).toBe(integrationUser);
		expect(position.vaultShares).toHaveLength(3);
		expect(position.vaultShares.every((s) => s.shares >= 0n)).toBe(true);
		expect(position.vaultShares.every((s) => s.valueBase >= 0n)).toBe(true);

		const vaultTotal = position.vaultShares.reduce((sum, s) => sum + s.valueBase, 0n);
		expect(position.totalOnChain).toBe(vaultTotal + position.tokenBalance);
		expect(position.totalDeployable).toBe(position.totalOnChain);
	});
});
