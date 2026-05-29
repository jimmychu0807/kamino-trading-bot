import { DEFAULT_CU_PER_TX } from "@kamino-finance/klend-sdk";
import {
	type Address,
	appendTransactionMessageInstructions,
	compressTransactionMessageUsingAddressLookupTables,
	createTransactionMessage,
	type GetLatestBlockhashApi,
	getSignatureFromTransaction,
	type Instruction,
	pipe,
	prependTransactionMessageInstructions,
	type Rpc,
	type RpcSubscriptions,
	type Signature,
	type SignatureNotificationsApi,
	type SlotNotificationsApi,
	type SolanaRpcApi,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type TransactionSigner,
} from "@solana/kit";
import type { AddressesByLookupTableAddress } from "@solana/transaction-messages";
import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import {
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import type { BlockhashWithHeight } from "./types.ts";

const PRIORITY_FEE_MULTIPLIER = 2500;

export interface TransactionExecutor {
	sendInstructions(
		instructions: Instruction[],
		label: string,
		lookupTableAddresses?: Address[],
	): Promise<Signature>;
}

export class KitTransactionExecutor implements TransactionExecutor {
	private readonly sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;

	constructor(
		private readonly rpc: Rpc<SolanaRpcApi & GetLatestBlockhashApi>,
		rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
		private readonly signer: TransactionSigner,
	) {
		this.sendAndConfirm = sendAndConfirmTransactionFactory({
			rpc,
			rpcSubscriptions,
		});
	}

	async sendInstructions(
		instructions: Instruction[],
		label: string,
		lookupTableAddresses: Address[] = [],
	): Promise<Signature> {
		if (instructions.length === 0) {
			throw new Error(`No instructions to send for ${label}`);
		}

		const lookupTableMap = await this.fetchLookupTableAddressesMap(lookupTableAddresses);

		let lastSignature: Signature | undefined;
		for (const [index, instruction] of instructions.entries()) {
			const stepLabel = `${label} [${index + 1}/${instructions.length}]`;
			lastSignature = await this.sendAndConfirmInstruction(instruction, stepLabel, lookupTableMap);
		}

		if (!lastSignature) {
			throw new Error(`Failed to send instructions for ${label}`);
		}
		return lastSignature;
	}

	private async sendAndConfirmInstruction(
		instruction: Instruction,
		label: string,
		lookupTableMap: AddressesByLookupTableAddress,
	): Promise<Signature> {
		const blockhash = await this.fetchBlockhash();
		const transaction = await pipe(
			createTransactionMessage({ version: 0 }),
			(tx) => setTransactionMessageFeePayerSigner(this.signer, tx),
			(tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
			(tx) => prependTransactionMessageInstructions(getComputeBudgetInstructions(), tx),
			(tx) => appendTransactionMessageInstructions([instruction], tx),
			(tx) => compressTransactionMessageUsingAddressLookupTables(tx, lookupTableMap),
		);

		const signedTransaction = await signTransactionMessageWithSigners(transaction);
		// console.log("transaction:", transaction);

		const signature = getSignatureFromTransaction(signedTransaction);
		console.log(`Sending ${label} (${signature})...`);

		try {
			await this.sendAndConfirm(signedTransaction, {
				commitment: "confirmed",
				preflightCommitment: "confirmed",
				maxRetries: 0n,
				skipPreflight: true,
				minContextSlot: blockhash.slot,
			});
			console.log(`Confirmed ${label}: ${signature}`);
			return signature;
		} catch (error) {
			console.error(`Transaction ${signature} failed for ${label}:`, error);
			throw error;
		}
	}

	private async fetchBlockhash(): Promise<BlockhashWithHeight> {
		const response = await this.rpc.getLatestBlockhash({ commitment: "finalized" }).send();
		return {
			blockhash: response.value.blockhash,
			lastValidBlockHeight: response.value.lastValidBlockHeight,
			slot: response.context.slot,
		};
	}

	private async fetchLookupTableAddressesMap(
		lookupTableAddresses: Address[],
	): Promise<AddressesByLookupTableAddress> {
		const map: AddressesByLookupTableAddress = {};
		for (const lookupTableAddress of lookupTableAddresses) {
			const account = await fetchAddressLookupTable(
				this.rpc as Parameters<typeof fetchAddressLookupTable>[0],
				lookupTableAddress,
			);
			if (!account.data) {
				continue;
			}
			map[account.address] = account.data.addresses;
		}
		return map;
	}
}

function getComputeBudgetInstructions(computeUnits = DEFAULT_CU_PER_TX): Instruction[] {
	const microLamportsPerUnit = Math.round((1_000_000 / computeUnits) * PRIORITY_FEE_MULTIPLIER);
	return [
		getSetComputeUnitLimitInstruction({ units: computeUnits }),
		getSetComputeUnitPriceInstruction({ microLamports: microLamportsPerUnit }),
	];
}
