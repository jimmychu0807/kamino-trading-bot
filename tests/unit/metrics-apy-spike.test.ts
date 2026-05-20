import { afterEach, describe, expect, test } from "bun:test";
import {
	buildMetricsSnapshot,
	clearApyHistory,
	computeYieldVolatility,
	findApySpikeSnapshots,
	getTrailingApyAverage,
	isApySpikeAnomaly,
	markSnapshotTradingValidity,
} from "../../src/kamino/metrics.ts";

afterEach(() => {
	clearApyHistory();
});

describe("APY spike guard", () => {
	test("getTrailingApyAverage returns null until enough history", () => {
		computeYieldVolatility("vault-a", 0.05);
		expect(getTrailingApyAverage("vault-a")).toBeNull();
		computeYieldVolatility("vault-a", 0.06);
		expect(getTrailingApyAverage("vault-a")).toBeCloseTo(0.055, 5);
	});

	test("isApySpikeAnomaly when net APY exceeds multiple × trailing average", () => {
		computeYieldVolatility("vault-b", 0.04);
		computeYieldVolatility("vault-b", 0.05);
		const trailing = getTrailingApyAverage("vault-b");
		expect(isApySpikeAnomaly(0.2, trailing, 3)).toBe(true);
		expect(isApySpikeAnomaly(0.1, trailing, 3)).toBe(false);
	});

	test("markSnapshotTradingValidity flags fresh spike snapshots", () => {
		computeYieldVolatility("vault-c", 0.05);
		computeYieldVolatility("vault-c", 0.05);
		const snapshot = buildMetricsSnapshot({
			vaultAddress: "vault-c",
			netApy: 0.2,
			fresh: true,
		});
		const marked = markSnapshotTradingValidity(snapshot, { apySpikeGuardMultiple: 3 });
		expect(marked.validForTrading).toBe(false);
	});

	test("findApySpikeSnapshots returns only fresh invalid snapshots", () => {
		const spike = buildMetricsSnapshot({
			vaultAddress: "v1",
			netApy: 1,
			fresh: true,
			validForTrading: false,
		});
		const stale = buildMetricsSnapshot({
			vaultAddress: "v2",
			netApy: 1,
			fresh: false,
			validForTrading: false,
		});
		const ok = buildMetricsSnapshot({
			vaultAddress: "v3",
			netApy: 0.05,
			fresh: true,
			validForTrading: true,
		});
		expect(findApySpikeSnapshots([spike, stale, ok])).toEqual([spike]);
	});
});
