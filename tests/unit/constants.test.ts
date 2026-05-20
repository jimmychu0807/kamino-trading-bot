import { describe, expect, test } from "bun:test";
import { EXAMPLE_VAULT_ADDRESSES, isBase58Address } from "../../src/constants.ts";

describe("EXAMPLE_VAULT_ADDRESSES", () => {
	test("example vault addresses are valid base58", () => {
		for (const addr of Object.values(EXAMPLE_VAULT_ADDRESSES)) {
			expect(isBase58Address(addr)).toBe(true);
		}
	});
});

describe("isBase58Address", () => {
	test("rejects empty and invalid characters", () => {
		expect(isBase58Address("")).toBe(false);
		expect(isBase58Address("not-a-valid-address!!!")).toBe(false);
		expect(isBase58Address("0OIl")).toBe(false);
	});
});
