import { describe, expect, test } from "bun:test";
import { CLI_HELP_TEXT, wantsHelp } from "../../src/cli/help.ts";

describe("cli help", () => {
	test("wantsHelp detects --help and -h", () => {
		expect(wantsHelp(["--help"])).toBe(true);
		expect(wantsHelp(["-h"])).toBe(true);
		expect(wantsHelp(["cycle", "--help"])).toBe(true);
		expect(wantsHelp(["cycle"])).toBe(false);
	});

	test("CLI_HELP_TEXT documents all commands", () => {
		expect(CLI_HELP_TEXT).toContain("cycle");
		expect(CLI_HELP_TEXT).toContain("ack-hold");
		expect(CLI_HELP_TEXT).toContain("backtest");
		expect(CLI_HELP_TEXT).toContain("--max-allocation");
		expect(CLI_HELP_TEXT).toContain("--run-for-secs");
		expect(CLI_HELP_TEXT).toContain("--import");
	});
});
