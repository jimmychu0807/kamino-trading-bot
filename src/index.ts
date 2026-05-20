import { createKeyPairSignerFromBytes, getBase58Codec } from "@solana/kit";
import { loadConfig } from "./config.ts";
import { DEFAULT_PROD_USER, VAULT_ADDRESSES } from "./constants.ts";
import { fetchVaultAllocations, fetchVaultSummary } from "./vault.ts";

async function main() {
	const config = loadConfig();
	const keypairBytes = getBase58Codec().encode(config.privateKey);
	const signer = await createKeyPairSignerFromBytes(keypairBytes);

	const summary = await fetchVaultSummary(
		config.solanaRpc,
		VAULT_ADDRESSES.allezUsds,
		config.prodAddress,
	);

	console.log(summary);

	const alloc = await fetchVaultAllocations(
		config.solanaRpc,
		VAULT_ADDRESSES.allezUsds,
	);

	console.log("--- Allocations ---");
	for (const [reserveAddress, overview] of alloc) {
		console.log(`Reserve: ${reserveAddress}: overview:`, overview);
	}

	console.log({ signer: signer.address, defaultProdUser: DEFAULT_PROD_USER });
}

try {
	await main();
} catch (err) {
	console.error("Application error occurred", err);
	process.exit(1);
}
