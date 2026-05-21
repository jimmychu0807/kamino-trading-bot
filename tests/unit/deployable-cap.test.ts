import { describe, expect, test } from "bun:test";
import type { WalletPosition } from "../../src/kamino/reconcile.ts";
import {
	applyMaxAllocationCap,
	computeEffectiveDeployable,
	computeWalletBalanceCounted,
} from "../../src/strategy/deployable.ts";

const MAX = 100_000_000n;

function basePosition(vaultTotal: bigint, tokenBalance: bigint): WalletPosition {
	return {
		walletAddress: "wallet",
		tokenBalance,
		vaultShares: [{ vaultAddress: "v1", shares: 1n, valueBase: vaultTotal }],
		totalOnChain: vaultTotal + tokenBalance,
		walletBalanceCounted: tokenBalance,
		totalDeployable: vaultTotal + tokenBalance,
	};
}

describe("computeEffectiveDeployable", () => {
	test("no cap: vault + full wallet", () => {
		expect(computeEffectiveDeployable(90_000_000n, 50_000_000n)).toBe(140_000_000n);
	});

	test("initial deploy: $90 vault + $10 wallet under $100 cap", () => {
		expect(computeEffectiveDeployable(90_000_000n, 10_000_000n, MAX)).toBe(100_000_000n);
	});

	test("yield growth: $120 vault + $10 wallet exceeds cap — no clip", () => {
		expect(computeEffectiveDeployable(120_000_000n, 10_000_000n, MAX)).toBe(130_000_000n);
	});

	test("excess idle wallet: only allowance counted", () => {
		expect(computeEffectiveDeployable(90_000_000n, 50_000_000n, MAX)).toBe(100_000_000n);
		expect(computeWalletBalanceCounted(90_000_000n, 50_000_000n, MAX)).toBe(10_000_000n);
	});

	test("vault exactly at cap: full wallet counts", () => {
		expect(computeWalletBalanceCounted(100_000_000n, 10_000_000n, MAX)).toBe(10_000_000n);
	});

	test("zero wallet under cap", () => {
		expect(computeEffectiveDeployable(90_000_000n, 0n, MAX)).toBe(90_000_000n);
	});
});

describe("applyMaxAllocationCap", () => {
	test("updates audit fields on position", () => {
		const capped = applyMaxAllocationCap(basePosition(120_000_000n, 10_000_000n), MAX);
		expect(capped.totalOnChain).toBe(130_000_000n);
		expect(capped.walletBalanceCounted).toBe(10_000_000n);
		expect(capped.totalDeployable).toBe(130_000_000n);
		expect(capped.tokenBalance).toBe(10_000_000n);
	});

	test("clips excess wallet only", () => {
		const capped = applyMaxAllocationCap(basePosition(90_000_000n, 50_000_000n), MAX);
		expect(capped.totalOnChain).toBe(140_000_000n);
		expect(capped.walletBalanceCounted).toBe(10_000_000n);
		expect(capped.totalDeployable).toBe(100_000_000n);
	});

	test("unset cap leaves position unchanged", () => {
		const position = basePosition(90_000_000n, 10_000_000n);
		const result = applyMaxAllocationCap(position);
		expect(result.totalDeployable).toBe(100_000_000n);
		expect(result.walletBalanceCounted).toBe(10_000_000n);
	});
});
