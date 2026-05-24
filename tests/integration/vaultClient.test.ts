import { describe, expect, test } from "bun:test";
import { address, createSolanaRpc } from "@solana/kit";
import { KaminoVaultClientAdapter } from "../../src/kamino/vaultClient.ts";

const EXAMPLE_VAULT = "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E";
const DEFAULT_USER = address("11111111111111111111111111111111");

describe.skipIf(!process.env.SOLANA_RPC)("vault client integration", () => {
	test("loads vault state and reads user shares", async () => {
		const rpcUrl = process.env.SOLANA_RPC;
		if (!rpcUrl) {
			throw new Error("SOLANA_RPC is required");
		}
		const rpc = createSolanaRpc(rpcUrl);
		const client = new KaminoVaultClientAdapter(rpc);
		const user = process.env.TEST_WALLET ? address(process.env.TEST_WALLET) : DEFAULT_USER;

		await client.preloadVaults([EXAMPLE_VAULT]);
		const positions = await client.getPositions(user, [EXAMPLE_VAULT]);

		expect(positions).toHaveLength(1);
		expect(positions[0]?.vault).toBe(EXAMPLE_VAULT);
		expect(Number.isFinite(positions[0]?.tokenValue)).toBe(true);
		expect(positions[0]?.tokenValue).toBeGreaterThanOrEqual(0);
	});
});
