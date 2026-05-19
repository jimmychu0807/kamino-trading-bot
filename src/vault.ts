import { KaminoVault } from "@kamino-finance/klend-sdk";
import { address, createSolanaRpc } from "@solana/kit";

export type VaultSummary = {
	holdings: ReturnType<
		Awaited<ReturnType<KaminoVault["getVaultHoldings"]>>["asJSON"]
	>;
	apys: Awaited<ReturnType<KaminoVault["getAPYs"]>>;
	exchangeRate: string;
	shares: string;
	value: string;
};

export function createVaultClient(rpcUrl: string, vaultAddress: string) {
	const rpc = createSolanaRpc(rpcUrl);
	return new KaminoVault(rpc, address(vaultAddress));
}

export async function fetchVaultSummary(
	rpcUrl: string,
	vaultAddress: string,
	userAddress: string,
): Promise<VaultSummary> {
	const vault = createVaultClient(rpcUrl, vaultAddress);
	const user = address(userAddress);

	const holdings = await vault.getVaultHoldings();
	const apys = await vault.getAPYs();
	const exchangeRate = await vault.getExchangeRate();
	const shares = await vault.getUserShares(user);

	return {
		holdings: holdings.asJSON(),
		apys,
		exchangeRate: exchangeRate.toString(),
		shares: shares.totalShares.toString(),
		value: shares.totalShares.mul(exchangeRate).toString(),
	};
}

export async function fetchVaultAllocations(
	rpcUrl: string,
	vaultAddress: string,
) {
	const vault = createVaultClient(rpcUrl, vaultAddress);
	return vault.getVaultAllocations();
}
