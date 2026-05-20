import { KaminoVault } from "@kamino-finance/klend-sdk";
import { type Address, address, createSolanaRpc } from "@solana/kit";
import type { AppRpc } from "../chain/rpc.ts";

export type VaultSummary = {
	holdings: ReturnType<
		Awaited<ReturnType<KaminoVault["getVaultHoldings"]>>["asJSON"]
	>;
	apys: Awaited<ReturnType<KaminoVault["getAPYs"]>>;
	exchangeRate: string;
	shares: string;
	value: string;
};

export function createVaultClient(
	rpc: AppRpc,
	vaultAddress: string | Address,
): KaminoVault {
	return new KaminoVault(rpc, address(vaultAddress));
}

/** Legacy helper — prefer shared Rpc from `createRpcClients`. */
export function createVaultClientFromUrl(
	rpcUrl: string,
	vaultAddress: string,
): KaminoVault {
	return createVaultClient(createSolanaRpc(rpcUrl), vaultAddress);
}

export async function fetchVaultSummary(
	rpcOrUrl: AppRpc | string,
	vaultAddress: string | Address,
	userAddress: string | Address,
): Promise<VaultSummary> {
	const rpc =
		typeof rpcOrUrl === "string" ? createSolanaRpc(rpcOrUrl) : rpcOrUrl;
	const vault = createVaultClient(rpc, vaultAddress);
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
	rpcOrUrl: AppRpc | string,
	vaultAddress: string | Address,
) {
	const rpc =
		typeof rpcOrUrl === "string" ? createSolanaRpc(rpcOrUrl) : rpcOrUrl;
	const vault = createVaultClient(rpc, vaultAddress);
	return vault.getVaultAllocations();
}
