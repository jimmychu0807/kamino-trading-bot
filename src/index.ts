import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { loadConfigFromEnv } from "./config/load.ts";
import { runCycle } from "./cycle/runner.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

async function main() {
	const config = loadConfigFromEnv();
	runMigrations(config.databaseUrl);
	const db = createDb(config.databaseUrl);
	const clients = createRpcClients(config.solanaRpc, config.rpcTimeoutMs);
	const signer = await createSignerFromPrivateKey(config.privateKey);

	const abort = AbortSignal.timeout(config.cycleTimeoutMs);
	const result = await runCycle({
		config,
		clients,
		signer,
		db,
		now: new Date(),
		abortSignal: abort,
	});

	console.log(
		JSON.stringify(
			{
				cycleId: result.cycleId,
				status: result.status,
				previewMode: config.previewMode,
				rationale: result.decisionLog.rationale,
				plannedLegs: result.actions.length,
			},
			null,
			2,
		),
	);
}

try {
	await main();
} catch (err) {
	console.error("Application error occurred", err);
	process.exit(1);
}
