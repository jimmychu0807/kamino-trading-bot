import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { address } from "@solana/kit";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

/** Mainnet USDC mint (vaults in this bot use USDC). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const LAMPORTS_PER_SOL = 1_000_000_000;

export type WalletBalances = {
	sol: number;
	usdc: number;
};

export interface WalletBalanceReader {
	getBalances(owner: Address): Promise<WalletBalances>;
}

export function getUsdcAssociatedTokenAddress(owner: Address, mint = USDC_MINT): Address {
	const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner));
	return address(ata.toBase58());
}

export class RpcWalletBalanceReader implements WalletBalanceReader {
	constructor(
		private readonly rpc: Rpc<SolanaRpcApi>,
		private readonly usdcMint: string = USDC_MINT,
	) {}

	async getBalances(owner: Address): Promise<WalletBalances> {
		const [solResponse, usdc] = await Promise.all([
			this.rpc.getBalance(owner, { commitment: "confirmed" }).send(),
			this.getUsdcBalance(owner),
		]);

		return {
			sol: Number(solResponse.value) / LAMPORTS_PER_SOL,
			usdc,
		};
	}

	private async getUsdcBalance(owner: Address): Promise<number> {
		const ata = getUsdcAssociatedTokenAddress(owner, this.usdcMint);
		try {
			const response = await this.rpc
				.getTokenAccountBalance(ata, { commitment: "confirmed" })
				.send();
			return response.value.uiAmount ?? 0;
		} catch {
			return 0;
		}
	}
}
