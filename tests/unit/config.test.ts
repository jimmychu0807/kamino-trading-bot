import { describe, expect, test } from "bun:test";
import { loadConfig, loadRpcUrl } from "../../src/config.ts";

describe("loadConfig", () => {
	test("throws when SOLANA_RPC is missing", () => {
		expect(() => loadConfig({ PRIVATE_KEY: "abc", SOLANA_RPC: "" })).toThrow(
			"SOLANA_RPC not defined",
		);
	});

	test("throws when PRIVATE_KEY is missing", () => {
		expect(() =>
			loadConfig({ SOLANA_RPC: "https://rpc.example.com", PRIVATE_KEY: "" }),
		).toThrow("PRIVATE_KEY not defined");
	});

	test("returns config when env is valid", () => {
		const config = loadConfig({
			SOLANA_RPC: "https://rpc.example.com",
			PRIVATE_KEY: "5HueCGUQU5b",
			PROD_ADDR: "6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ",
		});

		expect(config.solanaRpc).toBe("https://rpc.example.com");
		expect(config.privateKey).toBe("5HueCGUQU5b");
		expect(config.prodAddress).toBe(
			"6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ",
		);
	});

	test("uses default prod address when PROD_ADDR is omitted", () => {
		const config = loadConfig({
			SOLANA_RPC: "https://rpc.example.com",
			PRIVATE_KEY: "5HueCGUQU5b",
		});

		expect(config.prodAddress).toBe(
			"6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ",
		);
	});
});

describe("loadRpcUrl", () => {
	test("throws when SOLANA_RPC is missing", () => {
		expect(() => loadRpcUrl({})).toThrow("SOLANA_RPC not defined");
	});

	test("returns rpc url when set", () => {
		expect(loadRpcUrl({ SOLANA_RPC: "https://rpc.example.com" })).toBe(
			"https://rpc.example.com",
		);
	});
});
