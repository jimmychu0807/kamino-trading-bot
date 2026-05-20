import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { loadConfigFromEnv } from "./config/load.ts";
import { startTradingBot } from "./cycle/daemon.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

async function main() {
	const config = loadConfigFromEnv();
	runMigrations(config.databaseUrl);
	const db = createDb(config.databaseUrl);
	const clients = createRpcClients(config.solanaRpc, config.rpcTimeoutMs);
	const signer = await createSignerFromPrivateKey(config.privateKey);

	console.log(
		JSON.stringify({
			event: "bot_start",
			previewMode: config.previewMode,
			driftTriggerEnabled: config.driftTriggerEnabled,
			cronExpression: config.cronExpression,
		}),
	);

	await startTradingBot({ config, clients, signer, db });

	console.log(JSON.stringify({ event: "bot_stop" }));
}

try {
	await main();
} catch (err) {
	console.error("Application error occurred", err);
	process.exit(1);
}
