import { describe, expect, test } from "bun:test";
import { parseCycleCommandOptions, parseRunCommandOptions } from "../../src/cli/parse-args.ts";
import { loadConfigFromEnv, withMaxAllocationOverride } from "../../src/config/load.ts";

describe("parseRunCommandOptions", () => {
	test("parses positional run-for and cycle interval", () => {
		expect(parseRunCommandOptions(["30", "10"])).toEqual({
			runForSecs: 30,
			cycleIntervalSecs: 10,
		});
	});

	test("parses named flags", () => {
		expect(parseRunCommandOptions(["--run-for-secs=45", "--cycle-interval-secs=15"])).toEqual({
			runForSecs: 45,
			cycleIntervalSecs: 15,
		});
	});

	test("returns empty options when no overrides", () => {
		expect(parseRunCommandOptions([])).toEqual({});
	});

	test("rejects non-positive integers", () => {
		expect(() => parseRunCommandOptions(["0", "10"])).toThrow(/positive integer/);
	});
});

describe("parseCycleCommandOptions", () => {
	test("parses --max-allocation flag", () => {
		expect(parseCycleCommandOptions(["--max-allocation=100000000"])).toEqual({
			maxAllocationBase: 100_000_000n,
		});
	});

	test("parses -m alias", () => {
		expect(parseCycleCommandOptions(["-m", "5000000"])).toEqual({
			maxAllocationBase: 5_000_000n,
		});
	});

	test("returns empty options when no overrides", () => {
		expect(parseCycleCommandOptions([])).toEqual({});
	});

	test("rejects invalid max-allocation", () => {
		expect(() => parseCycleCommandOptions(["--max-allocation=0"])).toThrow(/greater than zero/);
		expect(() => parseCycleCommandOptions(["--max-allocation=abc"])).toThrow(
			/non-negative integer/,
		);
	});
});

describe("withMaxAllocationOverride", () => {
	const validEnv = {
		SOLANA_RPC: "https://rpc.example.com",
		PRIVATE_KEY: "5HueCGUQU5b",
		VAULTS:
			"HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E,A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo,DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
		MAX_ALLOCATION: "100000000",
	};

	test("CLI override replaces env value", () => {
		const cfg = withMaxAllocationOverride(loadConfigFromEnv(validEnv), 50_000_000n);
		expect(cfg.maxAllocationBase).toBe(50_000_000n);
	});
});
