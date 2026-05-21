export type RunCommandOptions = {
	runForSecs?: number;
	cycleIntervalSecs?: number;
};

export type CycleCommandOptions = {
	maxAllocationBase?: bigint;
};

function parsePositiveSecs(value: string, label: string): number {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error(`${label} must be a positive integer, got: ${value}`);
	}
	return n;
}

function parsePositiveBigInt(value: string, label: string): bigint {
	if (!/^[0-9]+$/.test(value)) {
		throw new Error(`${label} must be a non-negative integer string, got: ${value}`);
	}
	const n = BigInt(value);
	if (n <= 0n) {
		throw new Error(`${label} must be greater than zero, got: ${value}`);
	}
	return n;
}

function readFlagValue(argv: string[], flag: string): string | undefined {
	const eqPrefix = `${flag}=`;
	const entry = argv.find((arg) => arg === flag || arg.startsWith(eqPrefix));
	if (!entry) {
		return undefined;
	}
	if (entry.startsWith(eqPrefix)) {
		return entry.slice(eqPrefix.length);
	}
	const index = argv.indexOf(entry);
	return argv[index + 1];
}

/**
 * Parses `run` command options from argv (after the `run` subcommand).
 * Supports positional `run <runForSecs> [cycleIntervalSecs]` and flags
 * `--run-for-secs`, `--cycle-interval-secs` (aliases `-t`, `-i`).
 */
export function parseRunCommandOptions(argv: string[]): RunCommandOptions {
	const options: RunCommandOptions = {};

	const runForRaw =
		readFlagValue(argv, "--run-for-secs") ??
		readFlagValue(argv, "--run-for") ??
		readFlagValue(argv, "-t");
	if (runForRaw !== undefined) {
		options.runForSecs = parsePositiveSecs(runForRaw, "run-for-secs");
	}

	const intervalRaw =
		readFlagValue(argv, "--cycle-interval-secs") ??
		readFlagValue(argv, "--cycle-interval") ??
		readFlagValue(argv, "-i");
	if (intervalRaw !== undefined) {
		options.cycleIntervalSecs = parsePositiveSecs(intervalRaw, "cycle-interval-secs");
	}

	const positional = argv.filter((arg) => !arg.startsWith("-"));
	if (positional[0] !== undefined && options.runForSecs === undefined) {
		options.runForSecs = parsePositiveSecs(positional[0], "run-for-secs");
	}
	if (positional[1] !== undefined && options.cycleIntervalSecs === undefined) {
		options.cycleIntervalSecs = parsePositiveSecs(positional[1], "cycle-interval-secs");
	}

	return options;
}

/**
 * Parses `cycle` command options from argv (after the `cycle` subcommand).
 * `--max-allocation` (alias `-m`) overrides `MAX_ALLOCATION` from env for one cycle.
 */
export function parseCycleCommandOptions(argv: string[]): CycleCommandOptions {
	const options: CycleCommandOptions = {};

	const maxRaw = readFlagValue(argv, "--max-allocation") ?? readFlagValue(argv, "-m");
	if (maxRaw !== undefined) {
		options.maxAllocationBase = parsePositiveBigInt(maxRaw, "max-allocation");
	}

	return options;
}
