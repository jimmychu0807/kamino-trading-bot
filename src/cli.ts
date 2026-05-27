import { BotRunner } from "./bot/runner.ts";
import { loadConfig } from "./config/env.ts";
import { KitTransactionExecutor } from "./kamino/txExecutor.ts";
import { KaminoVaultClientAdapter } from "./kamino/vaultClient.ts";
import { KaminoApiYieldSource } from "./kamino/yieldSource.ts";
import { createSolanaContext, getSignerAddress } from "./solana/connection.ts";
import { RpcWalletBalanceReader } from "./solana/walletBalances.ts";

export type ParsedCliArgs = {
	durationSec?: number;
	intervalSec?: number;
	help: boolean;
};

function printHelp(): void {
	console.log(`Usage: bun run src/cli.ts [options]

Options:
  --duration <seconds>  Total runtime (overrides RUN_SECONDS)
  --interval <seconds>  Rebalance interval (overrides REBALANCE_INTERVAL_SECONDS)
  --help                Show this help message
`);
}

function parsePositiveInt(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
	const args: ParsedCliArgs = { help: false };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			args.help = true;
			continue;
		}
		if (arg === "--duration") {
			const value = argv[++i];
			if (!value) {
				throw new Error("--duration requires a value");
			}
			args.durationSec = parsePositiveInt(value, "--duration");
			continue;
		}
		if (arg === "--interval") {
			const value = argv[++i];
			if (!value) {
				throw new Error("--interval requires a value");
			}
			args.intervalSec = parsePositiveInt(value, "--interval");
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return args;
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
	const cli = parseCliArgs(argv);
	if (cli.help) {
		printHelp();
		return;
	}

	const config = loadConfig({
		durationSec: cli.durationSec,
		intervalSec: cli.intervalSec,
	});
	console.log("config:", config);

	const { rpc, rpcSubscriptions, signer } = await createSolanaContext(
		config.solanaRpc,
		config.privateKey,
	);

	const runner = new BotRunner({
		config,
		yieldSource: new KaminoApiYieldSource(),
		vaultClient: new KaminoVaultClientAdapter(rpc),
		txExecutor: new KitTransactionExecutor(rpc, rpcSubscriptions, signer),
		walletBalances: new RpcWalletBalanceReader(rpc),
		user: getSignerAddress(signer),
		signer,
	});

	await runner.run();
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
