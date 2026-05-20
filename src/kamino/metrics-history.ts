import { z } from "zod";
import { solanaAddressSchema } from "../config/schema.ts";
import type { ReserveWeight, VaultMetricsSnapshot } from "../strategy/types.ts";

export const KAMINO_API_BASE = "https://api.kamino.finance";

const decimalStringSchema = z.union([z.string(), z.number()]).transform((value) => {
	const n = typeof value === "number" ? value : Number.parseFloat(value);
	if (!Number.isFinite(n)) {
		throw new Error(`Invalid decimal: ${value}`);
	}
	return n;
});

const historicalReserveSchema = z.object({
	pubkey: solanaAddressSchema,
	supplyApy: decimalStringSchema.optional(),
	rewardsApy: decimalStringSchema.optional(),
	allocationRatio: decimalStringSchema,
	rewardTokens: z.array(z.unknown()).optional(),
});

export const kaminoHistoricalMetricsPointSchema = z.object({
	timestamp: z.union([z.string(), z.number()]),
	tvl: decimalStringSchema,
	solTvl: decimalStringSchema.optional(),
	apy: decimalStringSchema.optional(),
	apyTheoretical: decimalStringSchema.optional(),
	apyActual: decimalStringSchema,
	apyFarmRewards: decimalStringSchema.optional(),
	apyReservesIncentives: decimalStringSchema.optional(),
	apyIncentives: decimalStringSchema.optional(),
	sharePrice: decimalStringSchema.optional(),
	interest: decimalStringSchema.optional(),
	interestUsd: decimalStringSchema.optional(),
	interestSol: decimalStringSchema.optional(),
	reserves: z.array(historicalReserveSchema).default([]),
	vaultRewards: z.array(z.unknown()).optional(),
});

export type KaminoHistoricalMetricsPoint = z.infer<typeof kaminoHistoricalMetricsPointSchema>;

/** Serialized snapshot stored in `metric_snapshots.payload_json`. */
export const vaultMetricsSnapshotPayloadSchema = z.object({
	vaultAddress: solanaAddressSchema,
	capturedAt: z.string(),
	netApy: z.number(),
	tvlUsd: z.number(),
	utilization: z.number().nullable(),
	reserveWeights: z.array(
		z.object({
			reserveAddress: z.string(),
			weightPct: z.number(),
		}),
	),
	yieldVolatility: z.number(),
	source: z.enum(["chain", "api"]),
	fresh: z.boolean(),
	validForTrading: z.boolean().default(true),
});

export type VaultMetricsSnapshotPayload = z.infer<typeof vaultMetricsSnapshotPayloadSchema>;

export function parseHistoricalMetricsPoint(raw: unknown): KaminoHistoricalMetricsPoint {
	return kaminoHistoricalMetricsPointSchema.parse(raw);
}

export function parseTimestamp(value: string | number): Date {
	if (typeof value === "number") {
		return new Date(value);
	}
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid timestamp: ${value}`);
	}
	return new Date(parsed);
}

function reserveWeightsFromHistoryReserves(
	reserves: KaminoHistoricalMetricsPoint["reserves"],
): ReserveWeight[] {
	const active = reserves.filter((r) => r.allocationRatio > 0);
	const total = active.reduce((sum, r) => sum + r.allocationRatio, 0);
	if (total <= 0) return [];

	return active.map((reserve) => ({
		reserveAddress: reserve.pubkey,
		weightPct: (reserve.allocationRatio / total) * 100,
	}));
}

function utilizationFromReserves(
	reserves: KaminoHistoricalMetricsPoint["reserves"],
): number | null {
	const invested = reserves.reduce((sum, r) => sum + Math.max(0, r.allocationRatio), 0);
	if (invested <= 0) return null;
	return Math.min(1, invested);
}

export function historicalPointToSnapshot(
	vaultAddress: string,
	point: KaminoHistoricalMetricsPoint,
	options?: { yieldVolatility?: number },
): VaultMetricsSnapshot {
	const capturedAt = parseTimestamp(point.timestamp);
	const netApy = point.apyActual;
	const reserveWeights = reserveWeightsFromHistoryReserves(point.reserves);

	return {
		vaultAddress,
		capturedAt,
		netApy,
		tvlUsd: point.tvl,
		utilization: utilizationFromReserves(point.reserves),
		reserveWeights,
		yieldVolatility: options?.yieldVolatility ?? 0,
		source: "api",
		fresh: true,
		validForTrading: true,
	};
}

export function snapshotToPayload(snapshot: VaultMetricsSnapshot): VaultMetricsSnapshotPayload {
	return vaultMetricsSnapshotPayloadSchema.parse({
		vaultAddress: snapshot.vaultAddress,
		capturedAt: snapshot.capturedAt.toISOString(),
		netApy: snapshot.netApy,
		tvlUsd: snapshot.tvlUsd,
		utilization: snapshot.utilization,
		reserveWeights: snapshot.reserveWeights,
		yieldVolatility: snapshot.yieldVolatility,
		source: snapshot.source,
		fresh: snapshot.fresh,
		validForTrading: snapshot.validForTrading,
	});
}

export function payloadToSnapshot(payload: VaultMetricsSnapshotPayload): VaultMetricsSnapshot {
	return {
		...payload,
		capturedAt: new Date(payload.capturedAt),
		validForTrading: payload.validForTrading ?? true,
	};
}

export type FetchVaultMetricsHistoryOptions = {
	start?: Date | string;
	end?: Date | string;
	timeoutMs?: number;
	signal?: AbortSignal;
};

function formatQueryDate(value: Date | string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value instanceof Date) return value.toISOString();
	return value;
}

export async function fetchVaultMetricsHistory(
	vaultAddress: string,
	options: FetchVaultMetricsHistoryOptions = {},
): Promise<VaultMetricsSnapshot[]> {
	const url = new URL(`${KAMINO_API_BASE}/kvaults/vaults/${vaultAddress}/metrics/history`);
	const start = formatQueryDate(options.start);
	const end = formatQueryDate(options.end);
	if (start) url.searchParams.set("start", start);
	if (end) url.searchParams.set("end", end);

	const timeoutMs = options.timeoutMs ?? 15_000;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			throw new Error(`Kamino metrics history failed for ${vaultAddress}: HTTP ${response.status}`);
		}

		const raw = await response.json();
		const points = z.array(kaminoHistoricalMetricsPointSchema).parse(raw);
		const sorted = [...points].sort(
			(a, b) => parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime(),
		);

		const apyTrail: number[] = [];
		return sorted.map((point) => {
			const netApy = point.apyActual;
			apTrailPush(apyTrail, netApy);
			const yieldVolatility = trailingVolatility(apyTrail);
			return historicalPointToSnapshot(vaultAddress, point, { yieldVolatility });
		});
	} finally {
		clearTimeout(timeout);
	}
}

function apTrailPush(history: number[], netApy: number): void {
	history.push(netApy);
	if (history.length > 24) history.shift();
}

function trailingVolatility(history: number[]): number {
	if (history.length < 2) return 0;
	const mean = history.reduce((s, v) => s + v, 0) / history.length;
	if (mean <= 0) return 0;
	const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
	return Math.sqrt(variance) / mean;
}

export type ImportHistoricalMetricsOptions = FetchVaultMetricsHistoryOptions & {
	vaultAddresses: string[];
};

/** Fetch historical metrics for all vaults (FR-016 / T060). */
export async function importHistoricalMetrics(
	options: ImportHistoricalMetricsOptions,
): Promise<VaultMetricsSnapshot[]> {
	const { vaultAddresses, ...fetchOptions } = options;
	const perVault = await Promise.all(
		vaultAddresses.map((vaultAddress) => fetchVaultMetricsHistory(vaultAddress, fetchOptions)),
	);
	return perVault.flat();
}
