import {
	type Address,
	createKeyPairSignerFromBytes,
	createKeyPairSignerFromPrivateKeyBytes,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	getBase58Codec,
	type Rpc,
	type RpcSubscriptions,
	type SolanaRpcApi,
	type TransactionSigner,
} from "@solana/kit";
import { parsePrivateKeyBytes } from "../config/env.ts";

export type SolanaContext = {
	rpc: Rpc<SolanaRpcApi>;
	rpcSubscriptions: RpcSubscriptions;
	signer: TransactionSigner;
};

export async function createSolanaContext(
	rpcUrl: string,
	privateKey: string,
): Promise<SolanaContext> {
	const rpc = createSolanaRpc(rpcUrl);
	const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/i, "ws"));
	const keyBytes = getBase58Codec().encode(privateKey);
	const signer = await createKeyPairSignerFromBytes(keyBytes);

	return { rpc, rpcSubscriptions, signer };
}

export function getSignerAddress(signer: TransactionSigner): Address {
	return signer.address;
}
