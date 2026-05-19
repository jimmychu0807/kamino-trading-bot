import { KaminoVault, KaminoManager } from "@kamino-finance/klend-sdk";
import {
	address,
	createKeyPairSignerFromBytes,
	createSolanaRpc,
	getBase58Codec,
} from "@solana/kit";

const SOLANA_RPC: string = process.env.SOLANA_RPC ?? "";
const PRIVATE_KEY: string = process.env.PRIVATE_KEY ?? "";

const PROD_ADDR: string = "6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ";

// USDC vault addr
const USDC_VAULT_ADDR = "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E";
const STEAKHOUSE_USDC_VAULT = "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E";
const ALLEZ_USDS_VAULT = "A1USdsC4kypCgPw5dHAwmqDjfFKrtdVHtXLhDY9QvHQ3";

async function main() {
	if (!SOLANA_RPC) throw Error("SOLANA_RPC not defined");
	if (!PRIVATE_KEY) throw Error("PRIVATE_KEY not defined");

	const rpc = createSolanaRpc(SOLANA_RPC);
	const keypairBytes = getBase58Codec().encode(PRIVATE_KEY);
	const signer = await createKeyPairSignerFromBytes(keypairBytes);
	const signerAddr = signer.address;

	const prodUser = address(PROD_ADDR);

	const vault = new KaminoVault(rpc, address(ALLEZ_USDS_VAULT));

	console.log({
		holdings: (await vault.getVaultHoldings()).asJSON(),
		apys: await vault.getAPYs(),
		exchangeRate: (await vault.getExchangeRate()).toString(),
	});

	const alloc = await vault.getVaultAllocations();

	console.log("--- Allocations ---");
	for (const [address, overview] of alloc) {
		console.log(`Reserve: ${address}: overview:`, overview);
	}

	const manager = new KaminoManager(rpc);

	const shares = await vault.getUserShares(prodUser);
	const rate = await vault.getExchangeRate();

	console.log({
		shares: shares.totalShares.toString(),
		value: shares.totalShares.mul(rate).toString(),
	});

	// Using manager doesn't work
	// const userSharesAllVaults = await manager.getUserSharesBalanceAllVaults(signerAddr);

	// userSharesAllVaults.forEach((shares, vault) => {
	// 	console.log(`User share in ${vault}: ${shares}`)
	// });
}

try {
	await main();
} catch (err) {
	console.error("Application error occured", err);
}
