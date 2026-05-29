import {
	DEFAULT_PUBLIC_KEY,
	DEFAULT_RECENT_SLOT_DURATION_MS,
	type KaminoReserve,
	KaminoVault,
	KaminoVaultClient,
} from "@kamino-finance/klend-sdk";
import type { Address, Instruction, Rpc, Slot, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import { address } from "@solana/kit";
import Decimal from "decimal.js";
import type { VaultId, VaultPosition } from "../config/types.ts";

export type VaultInstructionsBundle = {
	instructions: Instruction[];
	lookupTableAddresses: Address[];
};

export interface VaultClient {
	getPositions(user: Address, vaults: VaultId[]): Promise<VaultPosition[]>;
	getLiquidity(vaults: VaultId[]): Promise<Map<VaultId, number>>;
	buildDepositIxs(
		vault: VaultId,
		user: TransactionSigner,
		tokenAmount: number,
	): Promise<VaultInstructionsBundle>;
	buildWithdrawIxs(
		vault: VaultId,
		user: TransactionSigner,
		tokenAmount: number,
	): Promise<VaultInstructionsBundle>;
	preloadVaults(vaults: VaultId[]): Promise<void>;
}

type VaultRuntime = {
	vault: KaminoVault;
	reservesMap: Map<Address, KaminoReserve>;
};

export class KaminoVaultClientAdapter implements VaultClient {
	private readonly vaultClient: KaminoVaultClient;
	private readonly vaults = new Map<VaultId, VaultRuntime>();

	constructor(private readonly rpc: Rpc<SolanaRpcApi>) {
		this.vaultClient = new KaminoVaultClient(rpc, DEFAULT_RECENT_SLOT_DURATION_MS);
	}

	async preloadVaults(vaults: VaultId[]): Promise<void> {
		for (const vaultId of vaults) {
			await this.ensureVault(vaultId);
		}
	}

	async getPositions(user: Address, vaults: VaultId[]): Promise<VaultPosition[]> {
		const slot = await this.getCurrentSlot();
		const positions: VaultPosition[] = [];

		for (const vaultId of vaults) {
			const { vault } = await this.ensureVault(vaultId);
			const vaultState = await vault.getState();
			const { ataBalance } = await this.vaultClient.getUserSharesState(user, vaultState);
			let stakedShares = new Decimal(0);
			for (const farmAddress of [vaultState.vaultFarm, vaultState.firstLossCapitalFarm]) {
				if (farmAddress === DEFAULT_PUBLIC_KEY) {
					continue;
				}
				const { farmBalance } = await this.vaultClient.getUserSharesState(
					user,
					vaultState,
					farmAddress,
				);
				stakedShares = stakedShares.add(farmBalance);
			}
			const totalShares = ataBalance.add(stakedShares);
			const exchangeRate = await vault.getExchangeRate(slot);
			const tokenValue = totalShares.mul(exchangeRate).toNumber();
			positions.push({ vault: vaultId, tokenValue });
		}

		return positions;
	}

	async getLiquidity(vaults: VaultId[]): Promise<Map<VaultId, number>> {
		const slot = await this.getCurrentSlot();
		const entries: [VaultId, number][] = [];

		for (const vaultId of vaults) {
			const { vault } = await this.ensureVault(vaultId);
			const holdings = await vault.getVaultHoldings(slot);
			const liquidity = holdings.totalAUMIncludingFees.sub(holdings.pendingFees).toNumber();
			entries.push([vaultId, liquidity]);
		}

		return new Map(entries);
	}

	async buildDepositIxs(
		vaultId: VaultId,
		user: TransactionSigner,
		tokenAmount: number,
	): Promise<VaultInstructionsBundle> {
		const { vault, reservesMap } = await this.ensureVault(vaultId);
		const vaultState = await vault.getState();
		const deposit = await vault.depositIxs(user, new Decimal(tokenAmount), reservesMap, null, null);
		return {
			instructions: [
				...deposit.depositIxs,
				...deposit.stakeInFarmIfNeededIxs,
				...deposit.stakeInFlcFarmIfNeededIxs,
			],
			lookupTableAddresses:
				vaultState.vaultLookupTable === DEFAULT_PUBLIC_KEY ? [] : [vaultState.vaultLookupTable],
		};
	}

	async buildWithdrawIxs(
		vaultId: VaultId,
		user: TransactionSigner,
		tokenAmount: number,
	): Promise<VaultInstructionsBundle> {
		const slot = await this.getCurrentSlot();
		const { vault, reservesMap } = await this.ensureVault(vaultId);
		const vaultState = await vault.getState();
		const exchangeRate = await vault.getExchangeRate(slot);
		const shareAmount = new Decimal(tokenAmount).div(exchangeRate);
		const withdraw = await vault.withdrawIxs(user, shareAmount, slot, reservesMap, null, null);
		return {
			instructions: [
				...withdraw.unstakeFromFarmIfNeededIxs,
				...withdraw.withdrawIxs,
				...withdraw.postWithdrawIxs,
			],
			lookupTableAddresses:
				vaultState.vaultLookupTable === DEFAULT_PUBLIC_KEY ? [] : [vaultState.vaultLookupTable],
		};
	}

	private async ensureVault(vaultId: VaultId): Promise<VaultRuntime> {
		const cached = this.vaults.get(vaultId);
		if (cached) {
			return cached;
		}

		const vaultAddress = address(vaultId);
		const vault = new KaminoVault(this.rpc, vaultAddress);
		vault.client = this.vaultClient;
		const state = await vault.getState();
		const reservesMap = await this.vaultClient.loadVaultReserves(state);
		vault.vaultReservesStateCache = reservesMap;

		const runtime = { vault, reservesMap };
		this.vaults.set(vaultId, runtime);
		return runtime;
	}

	private async getCurrentSlot(): Promise<Slot> {
		const response = await this.rpc.getSlot({ commitment: "confirmed" }).send();
		return response;
	}
}
