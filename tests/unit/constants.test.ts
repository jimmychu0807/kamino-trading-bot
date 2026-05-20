import { describe, expect, test } from "bun:test";
import {
	DEFAULT_PROD_USER,
	isBase58Address,
	VAULT_ADDRESSES,
} from "../../src/constants.ts";

describe("VAULT_ADDRESSES", () => {
	test("known vault addresses are valid base58", () => {
		for (const addr of Object.values(VAULT_ADDRESSES)) {
			expect(isBase58Address(addr)).toBe(true);
		}
	});

	test("default prod user is a valid base58 address", () => {
		expect(isBase58Address(DEFAULT_PROD_USER)).toBe(true);
	});
});

describe("isBase58Address", () => {
	test("rejects empty and invalid characters", () => {
		expect(isBase58Address("")).toBe(false);
		expect(isBase58Address("not-a-valid-address!!!")).toBe(false);
		expect(isBase58Address("0OIl")).toBe(false);
	});
});
