import { type OperatorConfig, parseOperatorConfig } from "../../src/config/schema.ts";
import type { CycleContext } from "../../src/cycle/runner.ts";
import type { AppDatabase } from "../../src/db/client.ts";
import { buildMetricsSnapshot } from "../../src/kamino/metrics.ts";
import { makeWalletPosition } from "./wallet-position.ts";

export const TEST_NOW = new Date("2026-05-20T12:00:00.000Z");

export const VAULT_A = "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E";
export const VAULT_B = "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo";
export const VAULT_C = "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE";

const vaultList = [{ address: VAULT_A }, { address: VAULT_B }, { address: VAULT_C }];

const basePolicy = {
	profile: "aggressive" as const,
	minTradeSizeBase: "1",
	minImprovementBps: 0,
	cooldownMs: 0,
	driftBandPct: 0,
};

export const basePreviewConfig = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	previewMode: true,
	vaults: vaultList,
	policy: basePolicy,
});

export const baseLiveConfig = parseOperatorConfig({
	solanaRpc: "https://rpc.example.com",
	privateKey: "5HueCGUQU5b",
	previewMode: false,
	consecutiveFailureThreshold: 3,
	vaults: vaultList,
	policy: basePolicy,
});

/** Concentrated in lowest-APY vault so rebalancing toward targets is warranted. */
export const imbalancedPosition = makeWalletPosition({
	tokenBalance: 0n,
	vaultShares: [
		{ vaultAddress: VAULT_A, shares: 1n, valueBase: 50n },
		{ vaultAddress: VAULT_B, shares: 1n, valueBase: 50n },
		{ vaultAddress: VAULT_C, shares: 1n, valueBase: 900n },
	],
	totalDeployable: 1_000n,
});

/** Even split — useful for hold / skip scenarios. */
export const balancedPosition = makeWalletPosition({
	tokenBalance: 0n,
	vaultShares: [
		{ vaultAddress: VAULT_A, shares: 1n, valueBase: 500n },
		{ vaultAddress: VAULT_B, shares: 1n, valueBase: 250n },
		{ vaultAddress: VAULT_C, shares: 1n, valueBase: 250n },
	],
	totalDeployable: 1_000n,
});

export function freshSnapshots(now: Date = TEST_NOW) {
	return [
		buildMetricsSnapshot({
			vaultAddress: VAULT_A,
			netApy: 12,
			tvlUsd: 50_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: VAULT_B,
			netApy: 10,
			tvlUsd: 40_000_000,
			capturedAt: now,
			fresh: true,
		}),
		buildMetricsSnapshot({
			vaultAddress: VAULT_C,
			netApy: 8,
			tvlUsd: 30_000_000,
			capturedAt: now,
			fresh: true,
		}),
	];
}

export function mockClients() {
	return { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 };
}

export function mockSigner() {
	return { address: "wallet" } as never;
}

export function buildCycleContext(
	db: AppDatabase,
	overrides: Partial<CycleContext> & { config?: OperatorConfig; now?: Date } = {},
): CycleContext {
	const now = overrides.now ?? TEST_NOW;
	return {
		config: overrides.config ?? basePreviewConfig,
		clients: overrides.clients ?? mockClients(),
		signer: overrides.signer ?? mockSigner(),
		db,
		now,
		alertEnv: overrides.alertEnv ?? {},
		reconcile: overrides.reconcile ?? (async () => imbalancedPosition),
		fetchMetrics: overrides.fetchMetrics ?? (async () => freshSnapshots(now)),
		executeActions: overrides.executeActions,
		abortSignal: overrides.abortSignal,
	};
}
