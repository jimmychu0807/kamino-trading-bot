/** Full CLI reference text (also mirrored in README.md). */
export const CLI_HELP_TEXT = `Kamino Vault Yield Rebalancer CLI

Usage:
  bun run cli [--help | -h]
  bun run cli <command> [options] [--help | -h]

Commands:
  cycle       Run one rebalance cycle (default when command is omitted)
  run         Start the trading bot daemon (cron or fixed interval)
  ack-hold    Acknowledge execution hold after repeated tx failures
  backtest    Replay allocation policy over historical metrics (no on-chain txs)

Global:
  All commands load configuration from .env (see README Environment section).
  PREVIEW_MODE=true (default) logs planned legs without sending transactions.

──────────────────────────────────────────────────────────────────────────────
cycle — one rebalance evaluation and optional execution
──────────────────────────────────────────────────────────────────────────────

  bun run cli
  bun run cli cycle
  bun run cli cycle --max-allocation=<base-units>
  bun run cli cycle -m <base-units>

Options:
  --max-allocation=<n>   Override MAX_ALLOCATION for this cycle only (token base units)
  -m <n>                 Alias for --max-allocation

Output: JSON with cycleId, status, outcome, rationale, plannedLegs, previewMode.

──────────────────────────────────────────────────────────────────────────────
run — trading bot daemon
──────────────────────────────────────────────────────────────────────────────

  bun run cli run
  bun run cli run <runForSecs> [cycleIntervalSecs]
  bun run cli run --run-for-secs=<n> [--cycle-interval-secs=<n>]

Options:
  --run-for-secs=<n>       Stop after N seconds (default: run until SIGINT/SIGTERM)
  --run-for=<n>            Alias for --run-for-secs
  -t <n>                   Alias for --run-for-secs
  --cycle-interval-secs=<n>  Rebalance every N seconds instead of CRON_EXPRESSION
  --cycle-interval=<n>     Alias for --cycle-interval-secs
  -i <n>                   Alias for --cycle-interval-secs

Positional (same meaning as flags):
  runForSecs             First positional → --run-for-secs
  cycleIntervalSecs      Second positional → --cycle-interval-secs

Notes:
  When cycle-interval-secs is omitted, scheduling uses CRON_EXPRESSION from .env.
  Equivalent to bun run start when no run-for or interval overrides are passed.

──────────────────────────────────────────────────────────────────────────────
ack-hold — clear execution hold
──────────────────────────────────────────────────────────────────────────────

  bun run cli ack-hold

Clears the hold set after three consecutive cycles with failed transactions.
Dependency holds (stale metrics, RPC timeouts) clear automatically when checks pass.

Exit code 1 when no active execution hold.

──────────────────────────────────────────────────────────────────────────────
backtest — historical policy replay
──────────────────────────────────────────────────────────────────────────────

  bun run cli backtest
  bun run cli backtest --import
  bun run cli backtest --import --start=<ISO-8601> --end=<ISO-8601>
  bun run cli backtest --start=<ISO-8601> --end=<ISO-8601>

Options:
  --import               Fetch Kamino metrics history for all VAULTS and persist to SQLite
  --start=<ISO-8601>     Lower bound for API fetch and/or DB load
  --end=<ISO-8601>       Upper bound for API fetch and/or DB load

Output: JSON BacktestReport (strategy vs equal-weight baseline).
No Solana RPC or wallet transactions; PRIVATE_KEY is loaded but unused.
`;

const COMMAND_HELP: Record<string, string> = {
	cycle: `cycle — one rebalance evaluation and optional execution

  bun run cli
  bun run cli cycle
  bun run cli cycle --max-allocation=<base-units>
  bun run cli cycle -m <base-units>

Options:
  --max-allocation=<n>   Override MAX_ALLOCATION for this cycle only (token base units)
  -m <n>                 Alias for --max-allocation

Output: JSON with cycleId, status, outcome, rationale, plannedLegs, previewMode.
`,
	run: `run — trading bot daemon

  bun run cli run
  bun run cli run <runForSecs> [cycleIntervalSecs]
  bun run cli run --run-for-secs=<n> [--cycle-interval-secs=<n>]

Options:
  --run-for-secs=<n>       Stop after N seconds (default: run until SIGINT/SIGTERM)
  --run-for=<n>            Alias
  -t <n>                   Alias
  --cycle-interval-secs=<n>  Rebalance every N seconds instead of CRON_EXPRESSION
  --cycle-interval=<n>     Alias
  -i <n>                   Alias

Positional: runForSecs [cycleIntervalSecs] (same meaning as flags above).
`,
	"ack-hold": `ack-hold — clear execution hold

  bun run cli ack-hold

Clears the hold after repeated transaction failures. Exit code 1 if no active hold.
`,
	backtest: `backtest — historical policy replay

  bun run cli backtest [--import] [--start=<ISO-8601>] [--end=<ISO-8601>]

Options:
  --import     Fetch Kamino metrics history into SQLite before replay
  --start=     Lower bound (ISO-8601) for API fetch and/or DB load
  --end=       Upper bound (ISO-8601) for API fetch and/or DB load
`,
};

export function wantsHelp(argv: string[]): boolean {
	return argv.includes("--help") || argv.includes("-h");
}

export function stripHelpFlags(argv: string[]): string[] {
	return argv.filter((arg) => arg !== "--help" && arg !== "-h");
}

export function printCliHelp(): void {
	console.log(CLI_HELP_TEXT);
}

export function printCommandHelp(command: string): void {
	const section = COMMAND_HELP[command];
	if (section) {
		console.log(section);
		return;
	}
	printCliHelp();
}
