import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { loadConfigFromEnv } from "./config/load.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "./constants.ts";
import { fetchVaultAllocations, fetchVaultSummary } from "./kamino/vault.ts";

async function main() {
	const config = loadConfigFromEnv();
	const clients = createRpcClients(config.solanaRpc, config.rpcTimeoutMs);
	const signer = await createSignerFromPrivateKey(config.privateKey);

	const vaultAddress =
		config.vaults[0]?.address ?? EXAMPLE_VAULT_ADDRESSES.steakhouseUsdc;

	const summary = await fetchVaultSummary(
		clients.rpc,
		vaultAddress,
		signer.address,
	);

	console.log(summary);

	const alloc = await fetchVaultAllocations(clients.rpc, vaultAddress);

	console.log("--- Allocations ---");
	for (const [reserveAddress, overview] of alloc) {
		console.log(`Reserve: ${reserveAddress}: overview:`, overview);
	}

	console.log({
		signer: signer.address,
		previewMode: config.previewMode,
		vaultCount: config.vaults.length,
	});
}

try {
	await main();
} catch (err) {
	console.error("Application error occurred", err);
	process.exit(1);
}
