import type { WalletPosition } from "../kamino/reconcile.ts";

export function sumVaultValueBase(position: Pick<WalletPosition, "vaultShares">): bigint {
	return position.vaultShares.reduce((sum, share) => sum + share.valueBase, 0n);
}

/** Portion of idle wallet balance counted toward strategy sizing. */
export function computeWalletBalanceCounted(
	vaultTotal: bigint,
	tokenBalance: bigint,
	maxAllocationBase?: bigint,
): bigint {
	if (maxAllocationBase === undefined) {
		return tokenBalance;
	}
	if (vaultTotal >= maxAllocationBase) {
		return tokenBalance;
	}
	const allowance = maxAllocationBase - vaultTotal;
	return tokenBalance < allowance ? tokenBalance : allowance;
}

export function computeEffectiveDeployable(
	vaultTotal: bigint,
	tokenBalance: bigint,
	maxAllocationBase?: bigint,
): bigint {
	const walletCounted = computeWalletBalanceCounted(vaultTotal, tokenBalance, maxAllocationBase);
	return vaultTotal + walletCounted;
}

export function applyMaxAllocationCap(
	position: WalletPosition,
	maxAllocationBase?: bigint,
): WalletPosition {
	const vaultTotal = sumVaultValueBase(position);
	const totalOnChain = vaultTotal + position.tokenBalance;
	const walletBalanceCounted = computeWalletBalanceCounted(
		vaultTotal,
		position.tokenBalance,
		maxAllocationBase,
	);
	const totalDeployable = vaultTotal + walletBalanceCounted;

	return {
		...position,
		totalOnChain,
		walletBalanceCounted,
		totalDeployable,
	};
}
