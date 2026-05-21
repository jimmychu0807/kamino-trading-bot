import { describe, expect, test } from "bun:test";
import {
	assertLatestSnapshotPopulated,
	assertNoDuplicateInitCreates,
	verifyMigrations,
} from "../../src/db/verify-migrations.ts";

describe("verifyMigrations", () => {
	test("latest snapshot matches schema (non-empty tables)", () => {
		expect(() => assertLatestSnapshotPopulated()).not.toThrow();
	});

	test("no post-init migration recreates core tables", () => {
		expect(() => assertNoDuplicateInitCreates()).not.toThrow();
	});

	test("full verification passes", () => {
		expect(() => verifyMigrations()).not.toThrow();
	});
});
