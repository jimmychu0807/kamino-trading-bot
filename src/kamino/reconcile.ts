import Decimal from "decimal.js";
import type { RpcClients } from "../chain/rpc.ts";
import type { TargetAllocation } from "../strategy/types.ts";
import {
	type CurrentAllocation,
	computeMaxDriftPct as computeAllocationMaxDriftPct,
} from "../strategy/warrant.ts";
import { createVaultClient } from "./vault.ts";

export type VaultSharePosition = {
	vaultAddress: string;
	shares: bigint;
	valueBase: bigint;
};

export type WalletPosition = {
	walletAddress: string;
	tokenBalance: bigint;
	vaultShares: VaultSharePosition[];
	/** Raw on-chain total: vault values + wallet token balance. */
	totalOnChain: bigint;
	/** Wallet token balance included in strategy sizing (may be capped). */
	walletBalanceCounted: bigint;
	/** Effective deployable capital for allocation (vault + counted wallet). */
	totalDeployable: bigint;
};

export type VaultPositionReader = {
	getUserShares: (walletAddress: string) => Promise<unknown>;
	getExchangeRate: () => Promise<unknown>;
};

export type ReconcileContext = {
	clients: RpcClients;
	walletAddress: string;
	vaultAddresses: string[];
	resolveWalletTokenBalanceBase?: (clients: RpcClients, walletAddress: string) => Promise<bigint>;
	createVaultReader?: (clients: RpcClients, vaultAddress: string) => VaultPositionReader;
};

function defaultVaultReader(clients: RpcClients, vaultAddress: string): VaultPositionReader {
	const vault = createVaultClient(clients.rpc, vaultAddress);
	return {
		getUserShares: (walletAddress) =>
			vault.getUserShares(walletAddress as Parameters<typeof vault.getUserShares>[0]),
		getExchangeRate: () => vault.getExchangeRate(),
	};
}

function parseBigIntLike(value: unknown): bigint {
	if (typeof value === "bigint") {
		return value;
	}
	if (typeof value === "number") {
		return BigInt(Math.trunc(value));
	}
	if (typeof value === "string") {
		return BigInt(value);
	}
	if (value && typeof value === "object" && "toString" in value) {
		const fn = value.toString;
		if (typeof fn === "function") {
			return BigInt(fn.call(value));
		}
	}
	throw new Error("Unable to parse bigint-like value");
}

function parseExchangeRate(value: unknown): Decimal {
	if (value instanceof Decimal) {
		return value;
	}
	return new Decimal(String(value));
}

function extractTotalShares(sharesResult: unknown): bigint {
	if (sharesResult && typeof sharesResult === "object" && "totalShares" in sharesResult) {
		return parseBigIntLike(sharesResult.totalShares);
	}
	return parseBigIntLike(sharesResult);
}

function toCurrentAllocations(position: WalletPosition): CurrentAllocation[] {
	if (position.totalDeployable <= 0n) {
		return position.vaultShares.map((share) => ({
			vaultAddress: share.vaultAddress,
			currentPct: 0,
		}));
	}

	const total = Number(position.totalDeployable);
	return position.vaultShares.map((share) => ({
		vaultAddress: share.vaultAddress,
		currentPct: (Number(share.valueBase) / total) * 100,
	}));
}

export async function reconcilePositions(ctx: ReconcileContext): Promise<WalletPosition> {
	const resolveWalletTokenBalanceBase = ctx.resolveWalletTokenBalanceBase ?? (async () => 0n);
	const createVaultReader = ctx.createVaultReader ?? defaultVaultReader;

	const tokenBalance = await resolveWalletTokenBalanceBase(ctx.clients, ctx.walletAddress);

	const vaultShares: VaultSharePosition[] = [];
	for (const vaultAddress of ctx.vaultAddresses) {
		const reader = createVaultReader(ctx.clients, vaultAddress);
		const [sharesResult, exchangeRateResult] = await Promise.all([
			reader.getUserShares(ctx.walletAddress),
			reader.getExchangeRate(),
		]);

		const shares = extractTotalShares(sharesResult);
		const exchangeRate = parseExchangeRate(exchangeRateResult);
		const valueBase = BigInt(new Decimal(shares.toString()).mul(exchangeRate).floor().toFixed(0));
		vaultShares.push({ vaultAddress, shares, valueBase });
	}

	const vaultTotal = vaultShares.reduce((sum, share) => sum + share.valueBase, 0n);
	const totalOnChain = vaultTotal + tokenBalance;

	return {
		walletAddress: ctx.walletAddress,
		tokenBalance,
		vaultShares,
		totalOnChain,
		walletBalanceCounted: tokenBalance,
		totalDeployable: totalOnChain,
	};
}

export function computeMaxDriftPct(
	position: WalletPosition,
	targets: Pick<TargetAllocation, "vaultAddress" | "targetPct">[],
): number {
	return computeAllocationMaxDriftPct(toCurrentAllocations(position), targets);
}
