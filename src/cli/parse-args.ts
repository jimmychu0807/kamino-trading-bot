export type RunCommandOptions = {
	runForSecs?: number;
	cycleIntervalSecs?: number;
};

function parsePositiveSecs(value: string, label: string): number {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error(`${label} must be a positive integer, got: ${value}`);
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
