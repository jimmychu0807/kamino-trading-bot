import type { Instruction } from "@solana/kit";
import {
	appendTransactionMessageInstruction,
	appendTransactionMessageInstructions,
	createTransactionMessage,
	getSignatureFromTransaction,
	pipe,
	type Signature,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type TransactionSigner,
} from "@solana/kit";
import type { RpcClients } from "./rpc.ts";
import { withRpcTimeout } from "./rpc.ts";

export type SendLegResult = {
	signature: Signature;
	attempts: number;
};

export type SendLegOptions = {
	maxAttempts?: number;
	initialBackoffMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildAndSendInstructions(
	clients: RpcClients,
	signer: TransactionSigner,
	instructions: Instruction[],
	options: SendLegOptions = {},
): Promise<SendLegResult> {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const signature = await sendInstructionsOnce(clients, signer, instructions);
			return { signature, attempts: attempt };
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts) {
				break;
			}
			const backoff = initialBackoffMs * 2 ** (attempt - 1);
			await sleep(backoff);
		}
	}

	throw new Error(`Transaction leg failed after ${maxAttempts} attempts`, {
		cause: lastError,
	});
}

async function sendInstructionsOnce(
	clients: RpcClients,
	signer: TransactionSigner,
	instructions: Instruction[],
): Promise<Signature> {
	const { value: latestBlockhash } = await withRpcTimeout(clients, (rpc) =>
		rpc.getLatestBlockhash().send(),
	);

	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayerSigner(signer, m),
		(m) => {
			if (instructions.length === 0) {
				return m;
			}
			const [onlyInstruction] = instructions;
			if (instructions.length === 1 && onlyInstruction) {
				return appendTransactionMessageInstruction(onlyInstruction, m);
			}
			return appendTransactionMessageInstructions(instructions, m);
		},
		(m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
	);

	const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

	const sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc: clients.rpc,
		// Cluster-agnostic factory; subscriptions URL matches RPC endpoint.
		rpcSubscriptions: clients.rpcSubscriptions as Parameters<
			typeof sendAndConfirmTransactionFactory
		>[0]["rpcSubscriptions"],
	});

	await sendAndConfirm(signedTransaction, { commitment: "confirmed" });
	return getSignatureFromTransaction(signedTransaction);
}
