import { type Address, createKeyPairSignerFromBytes, getBase58Codec } from "@solana/kit";
import {
	type OperatorConfig,
	parseOperatorConfig,
	type RebalancePolicy,
	type RiskProfile,
	type VaultConfig,
} from "./schema.ts";

export type { OperatorConfig, RebalancePolicy, RiskProfile, VaultConfig };

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined || value === "") {
		return defaultValue;
	}
	const normalized = value.trim().toLowerCase();
	if (["true", "1", "yes"].includes(normalized)) {
		return true;
	}
	if (["false", "0", "no"].includes(normalized)) {
		return false;
	}
	throw new Error(`Invalid boolean env value: ${value}`);
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
	if (value === undefined || value === "") {
		return defaultValue;
	}
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 0) {
		throw new Error(`Invalid integer env value: ${value}`);
	}
	return n;
}

function parseVaults(env: Record<string, string | undefined>): VaultConfig[] {
	const raw = env.VAULTS?.trim();
	if (!raw) {
		throw new Error("VAULTS not defined (expect three comma-separated addresses)");
	}
	const addresses = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (addresses.length !== 3) {
		throw new Error(`VAULTS must contain exactly 3 addresses, got ${addresses.length}`);
	}
	return addresses.map((address, i) => ({
		address,
		label: env[`VAULT_${i + 1}_LABEL`] ?? undefined,
		minAllocationPct: 0,
		enabled: true,
	}));
}

function buildPolicyFromEnv(
	env: Record<string, string | undefined>,
): Partial<RebalancePolicy> & { profile: RiskProfile } {
	const profile = (env.RISK_PROFILE?.trim() || "balanced") as RiskProfile;
	const policy: Partial<RebalancePolicy> & { profile: RiskProfile } = {
		profile,
		minTradeSizeBase: BigInt(env.MIN_TRADE_SIZE_BASE?.trim() || "1000000"),
	};

	if (env.MIN_IMPROVEMENT_BPS?.trim()) {
		policy.minImprovementBps = parsePositiveInt(env.MIN_IMPROVEMENT_BPS, 0);
	}
	if (env.MAX_SINGLE_VAULT_PCT?.trim()) {
		policy.maxSingleVaultPct = Number(env.MAX_SINGLE_VAULT_PCT);
	}
	if (env.COOLDOWN_MS?.trim()) {
		policy.cooldownMs = parsePositiveInt(env.COOLDOWN_MS, 0);
	}
	if (env.DRIFT_BAND_PCT?.trim()) {
		policy.driftBandPct = Number(env.DRIFT_BAND_PCT);
	}
	if (env.CASH_BUFFER_PCT?.trim()) {
		policy.cashBufferPct = Number(env.CASH_BUFFER_PCT);
	}
	if (env.CRITICAL_RISK_FLOOR?.trim()) {
		policy.criticalRiskFloor = Number(env.CRITICAL_RISK_FLOOR);
	}

	return policy;
}

export function loadConfigFromEnv(
	env: Record<string, string | undefined> = process.env,
): OperatorConfig {
	const solanaRpc = env.SOLANA_RPC?.trim() ?? "";
	const privateKey = env.PRIVATE_KEY?.trim() ?? "";

	if (!solanaRpc) {
		throw new Error("SOLANA_RPC not defined");
	}
	if (!privateKey) {
		throw new Error("PRIVATE_KEY not defined");
	}

	const previewMode = parseBoolean(env.PREVIEW_MODE, true);

	return parseOperatorConfig({
		solanaRpc,
		privateKey,
		vaults: parseVaults(env),
		policy: buildPolicyFromEnv(env),
		previewMode,
		driftTriggerEnabled: parseBoolean(env.DRIFT_TRIGGER_ENABLED, false),
		driftPollIntervalMs: parsePositiveInt(env.DRIFT_POLL_INTERVAL_MS, 300_000),
		metricsMaxAgeMs: parsePositiveInt(env.METRICS_MAX_AGE_MS, 900_000),
		rpcTimeoutMs: parsePositiveInt(env.RPC_TIMEOUT_MS, 15_000),
		cycleTimeoutMs: parsePositiveInt(env.CYCLE_TIMEOUT_MS, 180_000),
		legMaxAttempts: parsePositiveInt(env.LEG_MAX_ATTEMPTS, 3),
		consecutiveFailureThreshold: parsePositiveInt(env.CONSECUTIVE_FAILURE_THRESHOLD, 3),
		cronExpression: env.CRON_EXPRESSION?.trim() || "0 * * * *",
		databaseUrl: env.DATABASE_URL?.trim() || "./data/bot.sqlite",
	});
}

/** @deprecated Use `loadConfigFromEnv` — kept for transitional imports. */
export const loadConfig = loadConfigFromEnv;

export function loadRpcUrl(env: Record<string, string | undefined> = process.env): string {
	const solanaRpc = env.SOLANA_RPC?.trim() ?? "";
	if (!solanaRpc) {
		throw new Error("SOLANA_RPC not defined");
	}
	return solanaRpc;
}

export async function deriveWalletAddress(privateKeyBase58: string): Promise<Address> {
	const keypairBytes = getBase58Codec().encode(privateKeyBase58);
	const signer = await createKeyPairSignerFromBytes(keypairBytes);
	return signer.address;
}
