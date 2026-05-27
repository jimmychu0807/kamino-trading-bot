import { afterEach, describe, expect, test } from "bun:test";
import {
	loadConfig,
	parsePrivateKeyBytes,
	validateDurationInterval,
} from "../../src/config/env.ts";

const BASE_ENV = {
	SOLANA_RPC: "https://api.mainnet-beta.solana.com",
	PRIVATE_KEY:
		"[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64]",
	VAULT_ADDRESSES:
		"HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E,A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo,DWSXb18xZApz29vnQpgR2m6MynCT7PznaXt7Ut7M7KaP",
	MAX_ALLOCATION: "100",
};

const OPTIONAL_ENV_KEYS = [
	"RUN_SECONDS",
	"REBALANCE_INTERVAL_SECONDS",
	"DRY_RUN",
	"MIN_MOVE_AMOUNT",
] as const;

function withEnv(overrides: Record<string, string | undefined>): void {
	for (const key of OPTIONAL_ENV_KEYS) {
		if (!(key in overrides)) {
			delete process.env[key];
		}
	}

	for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("config", () => {
	afterEach(() => {
		for (const key of Object.keys(BASE_ENV)) {
			delete process.env[key];
		}
		for (const key of OPTIONAL_ENV_KEYS) {
			delete process.env[key];
		}
	});

	test("loads config from env with defaults", () => {
		withEnv({});
		const config = loadConfig();
		expect(config.vaultAddresses).toHaveLength(3);
		expect(config.maxAllocation).toBe(100);
		expect(config.intervalSec).toBe(900);
		expect(config.durationSec).toBeNull();
		expect(config.dryRun).toBe(true);
	});

	test("CLI overrides duration and interval", () => {
		withEnv({ RUN_SECONDS: "600", REBALANCE_INTERVAL_SECONDS: "120" });
		const config = loadConfig({ durationSec: 300, intervalSec: 60 });
		expect(config.durationSec).toBe(300);
		expect(config.intervalSec).toBe(60);
	});

	test("rejects duration <= interval", () => {
		withEnv({});
		expect(() => loadConfig({ durationSec: 60, intervalSec: 60 })).toThrow(
			"duration (60s) must be greater than interval (60s)",
		);
		expect(() => validateDurationInterval(30, 60)).toThrow();
	});

	test("accepts 1 to MAX_VAULT_COUNT vaults", () => {
		withEnv({ VAULT_ADDRESSES: "vault1" });
		expect(loadConfig().vaultAddresses).toEqual(["vault1"]);

		withEnv({ VAULT_ADDRESSES: "vault1,vault2" });
		expect(loadConfig().vaultAddresses).toEqual(["vault1", "vault2"]);
	});

	test("rejects vault count outside 1..MAX_VAULT_COUNT", () => {
		withEnv({ VAULT_ADDRESSES: " , , " });
		expect(() => loadConfig()).toThrow("between 1 and 3");

		withEnv({
			VAULT_ADDRESSES: "vault1,vault2,vault3,vault4",
		});
		expect(() => loadConfig()).toThrow("between 1 and 3");
	});

	test("parses PRIVATE_KEY JSON byte array", () => {
		const bytes = parsePrivateKeyBytes(BASE_ENV.PRIVATE_KEY);
		expect(bytes).toHaveLength(64);
		expect(bytes[0]).toBe(1);
	});
});
