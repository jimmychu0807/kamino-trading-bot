import { getBase58Decoder } from "@solana/kit";
import type { BotConfig, CliOverrides } from "./types.ts";

const DEFAULT_INTERVAL_SEC = 15 * 60;
const REQUIRED_VAULT_COUNT = 3;

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined || value.trim() === "") {
		return defaultValue;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "false" || normalized === "0") {
		return false;
	}
	throw new Error(`Invalid boolean value: ${value}`);
}

function parsePositiveNumber(value: string | undefined, name: string): number | null {
	if (value === undefined || value.trim() === "") {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number`);
	}
	return parsed;
}

function parseVaultAddresses(raw: string): BotConfig["vaultAddresses"] {
	const vaults = raw
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);

	if (vaults.length !== REQUIRED_VAULT_COUNT) {
		throw new Error(
			`VAULT_ADDRESSES must contain exactly ${REQUIRED_VAULT_COUNT} comma-separated vault pubkeys (got ${vaults.length})`,
		);
	}

	return vaults as BotConfig["vaultAddresses"];
}

export function validateDurationInterval(durationSec: number | null, intervalSec: number): void {
	if (durationSec !== null && durationSec <= intervalSec) {
		throw new Error(`duration (${durationSec}s) must be greater than interval (${intervalSec}s)`);
	}
}

export function loadConfig(overrides: CliOverrides = {}): BotConfig {
	const durationSec =
		overrides.durationSec ?? parsePositiveNumber(process.env.RUN_SECONDS, "RUN_SECONDS");
	const intervalSec =
		overrides.intervalSec ??
		parsePositiveNumber(process.env.REBALANCE_INTERVAL_SECONDS, "REBALANCE_INTERVAL_SECONDS") ??
		DEFAULT_INTERVAL_SEC;

	validateDurationInterval(durationSec, intervalSec);

	const maxAllocation = parsePositiveNumber(requireEnv("MAX_ALLOCATION"), "MAX_ALLOCATION");
	if (maxAllocation === null) {
		throw new Error("MAX_ALLOCATION must be a positive number");
	}

	const minMoveAmount = parsePositiveNumber(process.env.MIN_MOVE_AMOUNT, "MIN_MOVE_AMOUNT") ?? 0;

	return {
		solanaRpc: requireEnv("SOLANA_RPC"),
		privateKey: requireEnv("PRIVATE_KEY"),
		vaultAddresses: parseVaultAddresses(requireEnv("VAULT_ADDRESSES")),
		maxAllocation,
		durationSec,
		intervalSec,
		dryRun: parseBoolean(process.env.DRY_RUN, true),
		minMoveAmount,
	};
}

export function parsePrivateKeyBytes(privateKey: string): Uint8Array {
	const trimmed = privateKey.trim();
	if (trimmed.startsWith("[")) {
		const bytes = JSON.parse(trimmed) as number[];
		if (!Array.isArray(bytes) || bytes.length === 0) {
			throw new Error("PRIVATE_KEY JSON array is invalid");
		}
		return new Uint8Array(bytes);
	}

	return getBase58Decoder().decode(trimmed);
}
