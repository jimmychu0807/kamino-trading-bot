import { describe, expect, test } from "bun:test";
import { createRpcClients } from "../../src/chain/rpc.ts";
import { createSignerFromPrivateKey } from "../../src/chain/signer.ts";
import { loadRpcUrl } from "../../src/config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";
import { buildActionInstructions } from "../../src/cycle/execute.ts";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";

describe.skipIf(!runIntegration)("deposit/withdraw ix build", () => {
	test("builds withdrawIxs / depositIxs without sending transactions", async () => {
		const privateKey = Bun.env.PRIVATE_KEY?.trim();
		if (!privateKey) {
			throw new Error("PRIVATE_KEY required for integration ix build test");
		}

		const rpcUrl = loadRpcUrl();
		const clients = createRpcClients(rpcUrl, 15_000);
		const signer = await createSignerFromPrivateKey(privateKey);
		const vaultAddress = EXAMPLE_VAULT_ADDRESSES.allezUsdc;

		const withdrawIxs = await buildActionInstructions(
			{
				vaultAddress,
				kind: "withdraw",
				phase: "withdrawal",
				amountBase: 1n,
			},
			{ clients, signer },
		);
		expect(withdrawIxs.length).toBeGreaterThan(0);

		const depositIxs = await buildActionInstructions(
			{
				vaultAddress,
				kind: "deposit",
				phase: "deposit",
				amountBase: 1n,
			},
			{ clients, signer },
		);
		expect(depositIxs.length).toBeGreaterThan(0);
	});
});
