import type { VaultSharePosition, WalletPosition } from "../../src/kamino/reconcile.ts";

export function makeWalletPosition(input: {
	walletAddress?: string;
	tokenBalance?: bigint;
	vaultShares: VaultSharePosition[];
	/** Effective deployable; defaults to vaultTotal + tokenBalance. */
	totalDeployable?: bigint;
}): WalletPosition {
	const tokenBalance = input.tokenBalance ?? 0n;
	const vaultTotal = input.vaultShares.reduce((sum, share) => sum + share.valueBase, 0n);
	const totalOnChain = vaultTotal + tokenBalance;
	const totalDeployable = input.totalDeployable ?? totalOnChain;
	const walletBalanceCounted = totalDeployable - vaultTotal;

	return {
		walletAddress: input.walletAddress ?? "wallet",
		tokenBalance,
		vaultShares: input.vaultShares,
		totalOnChain,
		walletBalanceCounted,
		totalDeployable,
	};
}
