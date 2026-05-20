import { describe, expect, test } from "bun:test";
import { parseRunCommandOptions } from "../../src/cli/parse-args.ts";

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
