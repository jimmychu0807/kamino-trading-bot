import {
	appendTransactionMessageInstructions,
	createTransactionMessage,
	type GetLatestBlockhashApi,
	getSignatureFromTransaction,
	type Instruction,
	pipe,
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
import type { BlockhashWithHeight } from "./types.ts";

export interface TransactionExecutor {
	sendInstructions(instructions: Instruction[], label: string): Promise<Signature>;
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

	async sendInstructions(instructions: Instruction[], label: string): Promise<Signature> {
		if (instructions.length === 0) {
			throw new Error(`No instructions to send for ${label}`);
		}

		const blockhash = await this.fetchBlockhash();
		const transaction = await pipe(
			createTransactionMessage({ version: 0 }),
			(tx) => appendTransactionMessageInstructions(instructions, tx),
			(tx) => setTransactionMessageFeePayerSigner(this.signer, tx),
			(tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
			(tx) => signTransactionMessageWithSigners(tx),
		);

		const signature = getSignatureFromTransaction(transaction);
		console.log(`Sending ${label} (${signature})...`);

		try {
			await this.sendAndConfirm(transaction, {
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
}
