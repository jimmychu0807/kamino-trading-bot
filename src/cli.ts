import { createRpcClients } from "./chain/rpc.ts";
import { createSignerFromPrivateKey } from "./chain/signer.ts";
import { printCliHelp, printCommandHelp, stripHelpFlags, wantsHelp } from "./cli/help.ts";
import { parseCycleCommandOptions, parseRunCommandOptions } from "./cli/parse-args.ts";
import { loadConfigFromEnv, withMaxAllocationOverride } from "./config/load.ts";
import { runBacktest } from "./cycle/backtest.ts";
import { startTradingBot } from "./cycle/daemon.ts";
import { acknowledgeExecutionHold } from "./cycle/hold.ts";
import { runCycle } from "./cycle/runner.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

type BacktestCommandOptions = {
	start?: Date;
	end?: Date;
	importFromApi: boolean;
};

function readFlagValue(argv: string[], flag: string): string | undefined {
	const eqPrefix = `${flag}=`;
	const entry = argv.find((arg) => arg === flag || arg.startsWith(eqPrefix));
	if (!entry) return undefined;
	if (entry.startsWith(eqPrefix)) return entry.slice(eqPrefix.length);
	const index = argv.indexOf(entry);
	return argv[index + 1];
}

function parseBacktestCommandOptions(argv: string[]): BacktestCommandOptions {
	const options: BacktestCommandOptions = { importFromApi: false };
	const startRaw = readFlagValue(argv, "--start");
	const endRaw = readFlagValue(argv, "--end");
	if (startRaw) options.start = new Date(startRaw);
	if (endRaw) options.end = new Date(endRaw);
	if (argv.includes("--import")) options.importFromApi = true;
	return options;
}

async function runOneCycle(argv: string[]): Promise<void> {
	const cycleOptions = parseCycleCommandOptions(argv);
	const config = withMaxAllocationOverride(loadConfigFromEnv(), cycleOptions.maxAllocationBase);
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
				maxAllocationBase: config.maxAllocationBase?.toString() ?? null,
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

async function runBacktestCommand(argv: string[]): Promise<void> {
	const btOptions = parseBacktestCommandOptions(argv);
	const config = loadConfigFromEnv();
	runMigrations(config.databaseUrl);
	const db = createDb(config.databaseUrl);

	const report = await runBacktest({
		config,
		db,
		start: btOptions.start,
		end: btOptions.end,
		importFromApi: btOptions.importFromApi,
	});

	console.log(JSON.stringify(report, null, 2));
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

const rawArgv = process.argv.slice(2);

function resolveCommand(argv: string[]): { command: string | undefined; restArgv: string[] } {
	if (argv.length === 0) {
		return { command: undefined, restArgv: [] };
	}
	const first = argv[0];
	if (first === "--help" || first === "-h") {
		return { command: undefined, restArgv: [] };
	}
	const knownCommands = new Set(["cycle", "run", "ack-hold", "backtest"]);
	if (knownCommands.has(first)) {
		return { command: first, restArgv: stripHelpFlags(argv.slice(1)) };
	}
	return { command: undefined, restArgv: stripHelpFlags(argv) };
}

if (
	wantsHelp(rawArgv) &&
	(rawArgv.length === 0 || rawArgv[0] === "--help" || rawArgv[0] === "-h")
) {
	printCliHelp();
	process.exit(0);
}

const { command, restArgv } = resolveCommand(rawArgv);

if (wantsHelp(rawArgv)) {
	const helpCommand = command ?? "cycle";
	printCommandHelp(helpCommand);
	process.exit(0);
}

try {
	if (command === "run") {
		await runBot(restArgv);
	} else if (command === "ack-hold") {
		await runAckHold();
	} else if (command === "backtest") {
		await runBacktestCommand(restArgv);
	} else if (command === "cycle" || !command) {
		await runOneCycle(restArgv);
	} else {
		console.error(`Unknown command: ${command}`);
		console.error("Run `bun run cli --help` for usage.");
		process.exit(1);
	}
} catch (error) {
	console.error("CLI error:", error);
	process.exit(1);
}
