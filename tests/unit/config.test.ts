import { describe, expect, test } from "bun:test";
import { loadConfigFromEnv, loadRpcUrl } from "../../src/config/load.ts";
import {
	parseOperatorConfig,
	RISK_PROFILE_PRESETS,
} from "../../src/config/schema.ts";
import { EXAMPLE_VAULT_ADDRESSES } from "../../src/constants.ts";

const VAULT_TRIPLET = [
	EXAMPLE_VAULT_ADDRESSES.steakhouseUsdc,
	EXAMPLE_VAULT_ADDRESSES.allezUsdc,
	EXAMPLE_VAULT_ADDRESSES.elementalUsdg,
] as const;

const validEnv = {
	SOLANA_RPC: "https://rpc.example.com",
	PRIVATE_KEY: "5HueCGUQU5b",
	VAULTS: VAULT_TRIPLET.join(","),
};

function baseOperatorInput() {
	return {
		solanaRpc: validEnv.SOLANA_RPC,
		privateKey: validEnv.PRIVATE_KEY,
		vaults: VAULT_TRIPLET.map((address) => ({ address })),
		policy: {
			profile: "balanced" as const,
			minTradeSizeBase: "1000000",
		},
	};
}

describe("parseOperatorConfig", () => {
	test("requires exactly three vaults", () => {
		expect(() =>
			parseOperatorConfig({
				...baseOperatorInput(),
				vaults: VAULT_TRIPLET.slice(0, 2).map((address) => ({ address })),
			}),
		).toThrow();
	});

	test("rejects duplicate vault addresses", () => {
		expect(() =>
			parseOperatorConfig({
				...baseOperatorInput(),
				vaults: [
					{ address: VAULT_TRIPLET[0] },
					{ address: VAULT_TRIPLET[0] },
					{ address: VAULT_TRIPLET[2] },
				],
			}),
		).toThrow(/unique/i);
	});

	test("defaults previewMode to true", () => {
		const cfg = parseOperatorConfig({
			...baseOperatorInput(),
			previewMode: undefined,
		});
		expect(cfg.previewMode).toBe(true);
	});

	test("applies balanced risk profile preset caps", () => {
		const cfg = parseOperatorConfig(baseOperatorInput());
		expect(cfg.policy.maxSingleVaultPct).toBe(
			RISK_PROFILE_PRESETS.balanced.maxSingleVaultPct,
		);
		expect(cfg.policy.minImprovementBps).toBe(
			RISK_PROFILE_PRESETS.balanced.minImprovementBps,
		);
	});

	test("respects timeout and drift trigger fields", () => {
		const cfg = parseOperatorConfig({
			...baseOperatorInput(),
			rpcTimeoutMs: 20_000,
			cycleTimeoutMs: 240_000,
			driftTriggerEnabled: true,
			driftPollIntervalMs: 120_000,
		});
		expect(cfg.rpcTimeoutMs).toBe(20_000);
		expect(cfg.cycleTimeoutMs).toBe(240_000);
		expect(cfg.driftTriggerEnabled).toBe(true);
		expect(cfg.driftPollIntervalMs).toBe(120_000);
	});

	test("defaults vault maxAllocationPct to policy maxSingleVaultPct", () => {
		const cfg = parseOperatorConfig({
			...baseOperatorInput(),
			policy: { profile: "conservative", minTradeSizeBase: "1" },
		});
		for (const vault of cfg.vaults) {
			expect(vault.maxAllocationPct).toBe(
				RISK_PROFILE_PRESETS.conservative.maxSingleVaultPct,
			);
		}
	});
});

describe("loadConfigFromEnv", () => {
	test("throws when SOLANA_RPC is missing", () => {
		expect(() => loadConfigFromEnv({ ...validEnv, SOLANA_RPC: "" })).toThrow(
			"SOLANA_RPC not defined",
		);
	});

	test("throws when PRIVATE_KEY is missing", () => {
		expect(() => loadConfigFromEnv({ ...validEnv, PRIVATE_KEY: "" })).toThrow(
			"PRIVATE_KEY not defined",
		);
	});

	test("throws when VAULTS is missing or not three addresses", () => {
		expect(() => loadConfigFromEnv({ ...validEnv, VAULTS: "" })).toThrow(
			/VAULTS/,
		);
		expect(() =>
			loadConfigFromEnv({
				...validEnv,
				VAULTS: `${VAULT_TRIPLET[0]},${VAULT_TRIPLET[1]}`,
			}),
		).toThrow(/exactly 3/);
	});

	test("defaults previewMode to true when PREVIEW_MODE unset", () => {
		const cfg = loadConfigFromEnv(validEnv);
		expect(cfg.previewMode).toBe(true);
	});

	test("defaults driftTriggerEnabled to false", () => {
		const cfg = loadConfigFromEnv(validEnv);
		expect(cfg.driftTriggerEnabled).toBe(false);
	});

	test("loads valid operator config from env", () => {
		const cfg = loadConfigFromEnv({
			...validEnv,
			PREVIEW_MODE: "false",
			RISK_PROFILE: "aggressive",
		});
		expect(cfg.solanaRpc).toBe(validEnv.SOLANA_RPC);
		expect(cfg.vaults).toHaveLength(3);
		expect(cfg.previewMode).toBe(false);
		expect(cfg.policy.profile).toBe("aggressive");
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
