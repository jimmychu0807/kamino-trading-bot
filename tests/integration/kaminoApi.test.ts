import { describe, expect, test } from "bun:test";
import { KaminoApiYieldSource } from "../../src/kamino/yieldSource.ts";

const EXAMPLE_VAULTS = [
	"HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	"A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
	"DWSXb18xZApz29vnQpgR2m6MynCT7PznaXt7Ut7M7KaP",
];

describe("kamino API integration", () => {
	test("returns numeric APY for example vaults", async () => {
		const source = new KaminoApiYieldSource();
		for (const vault of EXAMPLE_VAULTS) {
			const apy = await source.getApy(vault);
			expect(Number.isFinite(apy)).toBe(true);
			expect(apy).toBeGreaterThan(0);
		}
	});
});
