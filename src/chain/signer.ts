import { createKeyPairSignerFromBytes, getBase58Codec, type TransactionSigner } from "@solana/kit";

export async function createSignerFromPrivateKey(
	privateKeyBase58: string,
): Promise<TransactionSigner> {
	const keypairBytes = getBase58Codec().encode(privateKeyBase58);
	return createKeyPairSignerFromBytes(keypairBytes);
}
