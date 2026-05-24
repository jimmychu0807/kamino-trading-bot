import {
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	address,
	pipe,
	createTransactionMessage,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	appendTransactionMessageInstructions,
	signTransactionMessageWithSigners,
	sendAndConfirmTransactionFactory,
	getSignatureFromTransaction,
} from "@solana/kit";
import { createKeyPairSignerFromBytes, getBase58Codec, type TransactionSigner } from "@solana/kit";
import { KaminoVault } from "@kamino-finance/klend-sdk";
import { Decimal } from "decimal.js";

async function createSignerFromPrivateKey(privateKeyBase58: string): Promise<TransactionSigner> {
	const keypairBytes = getBase58Codec().encode(privateKeyBase58);
	return createKeyPairSignerFromBytes(keypairBytes);
}

async function main() {
	if (!Bun.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY env not defined");
	if (!Bun.env.SOLANA_RPC) throw new Error("SOLANA_RPC env not defined");

	const signer = await createSignerFromPrivateKey(Bun.env.PRIVATE_KEY);

	const rpc = createSolanaRpc(Bun.env.SOLANA_RPC);
	const wssEndpoint = Bun.env.SOLANA_RPC?.replace(/^http/, "ws");
	const rpcSubscriptions = createSolanaRpcSubscriptions(wssEndpoint);

	const vault = new KaminoVault(
		rpc,
		// Steakhouse USDC(conservative): HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E
		address("HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E"),
	);

	const depositAmount = new Decimal(1.0);
	const bundle = await vault.depositIxs(signer, depositAmount);
	const instructions = [...(bundle.depositIxs || [])];

	console.log("instructions:", instructions);

	if (!instructions.length) {
		throw new Error("No instructions returned by Kamino SDK");
	}

	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

	const transactionMessage = pipe(
		createTransactionMessage({ version: 0 }),
		(tx) => setTransactionMessageFeePayerSigner(signer, tx),
		(tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
		(tx) => appendTransactionMessageInstructions(instructions, tx),
	);

	// console.log("transactionMessage:", transactionMessage);

	const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

	const signature = getSignatureFromTransaction(signedTransaction);

	console.log("signature:", signature);

	try {
		await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
			commitment: "confirmed",
			skipPreflight: true,
		});
		console.log("Deposit successful! Signature:", signature);
	} catch (e) {
		console.error("send tx error:", e);
	}
}

await main();
