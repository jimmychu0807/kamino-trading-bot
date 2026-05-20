import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { loadConfigFromEnv } from "./config/load.ts";
import { runCycle } from "./cycle/runner.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

async function runOneCycle(): Promise<void> {
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
				outcome: result.decisionLog.outcome,
				rationale: result.decisionLog.rationale,
				plannedLegs: result.actions.length,
				previewMode: config.previewMode,
			},
			null,
			2,
		),
	);
}

const command = process.argv[2];

try {
	if (command === "cycle" || !command) {
		await runOneCycle();
	} else {
		console.error(`Unknown command: ${command}`);
		console.error("Usage: bun run src/cli.ts [cycle]");
		process.exit(1);
	}
} catch (error) {
	console.error("CLI error:", error);
	process.exit(1);
}
