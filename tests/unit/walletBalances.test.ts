import { describe, expect, test } from "bun:test";
import { address, createSolanaRpc } from "@solana/kit";
import {
	getUsdcAssociatedTokenAddress,
	RpcWalletBalanceReader,
	USDC_MINT,
} from "../../src/solana/walletBalances.ts";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

describe("walletBalances", () => {
	test("derives USDC associated token address", () => {
		const owner = address("11111111111111111111111111111111");
		const ata = getUsdcAssociatedTokenAddress(owner);
		expect(ata).toBe("HJt8Tjdsc9ms9i4WCZEzhzr4oyf3ANcdzXrNdLPFqm3M");
	});

	test("reads SOL and USDC balances from RPC", async () => {
		const rpc = createSolanaRpc(SOLANA_RPC);
		const reader = new RpcWalletBalanceReader(rpc, USDC_MINT);
		const owner = address("11111111111111111111111111111111");
		const balances = await reader.getBalances(owner);

		expect(balances.sol).toBeGreaterThanOrEqual(0);
		expect(balances.usdc).toBeGreaterThanOrEqual(0);
		expect(Number.isFinite(balances.sol)).toBe(true);
		expect(Number.isFinite(balances.usdc)).toBe(true);
	});
});
