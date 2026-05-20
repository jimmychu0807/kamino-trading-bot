import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { parseRunCommandOptions } from "./cli/parse-args.ts";
import { loadConfigFromEnv } from "./config/load.ts";
import { startTradingBot } from "./cycle/daemon.ts";
import { acknowledgeExecutionHold } from "./cycle/hold.ts";
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

async function runAckHold(): Promise<void> {
	const config = loadConfigFromEnv();
	runMigrations(config.databaseUrl);
	const db = createDb(config.databaseUrl);

	const cleared = await acknowledgeExecutionHold(db);
	console.log(
		JSON.stringify({
			event: cleared ? "execution_hold_acknowledged" : "no_active_execution_hold",
			acknowledged: cleared,
		}),
	);

	if (!cleared) {
		process.exit(1);
	}
}

async function runBot(argv: string[]): Promise<void> {
	const runOptions = parseRunCommandOptions(argv);
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
			runForSecs: runOptions.runForSecs ?? null,
			cycleIntervalSecs: runOptions.cycleIntervalSecs ?? null,
			cronExpression: runOptions.cycleIntervalSecs === undefined ? config.cronExpression : null,
		}),
	);

	await startTradingBot({ config, clients, signer, db }, runOptions);

	console.log(JSON.stringify({ event: "bot_stop" }));
}

function printUsage(): void {
	console.error("Usage:");
	console.error("  bun run src/cli.ts [cycle]");
	console.error("  bun run src/cli.ts run [runForSecs] [cycleIntervalSecs]");
	console.error("  bun run src/cli.ts run --run-for-secs=<n> [--cycle-interval-secs=<n>]");
	console.error("  bun run src/cli.ts ack-hold");
	console.error("");
	console.error("  runForSecs: stop after N seconds (default: run until SIGINT/SIGTERM)");
	console.error(
		"  cycleIntervalSecs: rebalance every N seconds (default: CRON_EXPRESSION from .env)",
	);
}

const command = process.argv[2];
const restArgv = process.argv.slice(3);

try {
	if (command === "run") {
		await runBot(restArgv);
	} else if (command === "ack-hold") {
		await runAckHold();
	} else if (command === "cycle" || !command) {
		await runOneCycle();
	} else {
		console.error(`Unknown command: ${command}`);
		printUsage();
		process.exit(1);
	}
} catch (error) {
	console.error("CLI error:", error);
	process.exit(1);
}
