import { describe, expect, test } from "bun:test";
import { planRebalance, proportionalByApy } from "../../src/strategy/planRebalance.ts";

const VAULTS = ["vault-a", "vault-b", "vault-c"] as const;

function makeInput(overrides: {
	apy?: Record<string, number>;
	positions?: Record<string, number>;
	maxAllocation?: number;
	minMoveAmount?: number;
}) {
	const apyByVault = new Map(VAULTS.map((vault) => [vault, overrides.apy?.[vault] ?? 0.1]));
	const positions = VAULTS.map((vault) => ({
		vault,
		tokenValue: overrides.positions?.[vault] ?? 100,
	}));

	return {
		vaults: [...VAULTS],
		apyByVault,
		positions,
		maxAllocation: overrides.maxAllocation ?? 1000,
		minMoveAmount: overrides.minMoveAmount ?? 0,
	};
}

describe("planRebalance", () => {
	test("allocates proportionally by APY", () => {
		const input = makeInput({
			apy: { "vault-a": 0.1, "vault-b": 0.2, "vault-c": 0.3 },
			positions: { "vault-a": 100, "vault-b": 100, "vault-c": 100 },
			maxAllocation: 1000,
		});

		const plan = planRebalance(input);
		const deposits = plan.actions.filter((a) => a.kind === "deposit");
		const withdraws = plan.actions.filter((a) => a.kind === "withdraw");

		expect(withdraws.some((a) => a.vault === "vault-a")).toBe(true);
		expect(deposits.some((a) => a.vault === "vault-c")).toBe(true);
		expect(deposits.find((a) => a.vault === "vault-c")?.amount).toBeGreaterThan(
			deposits.find((a) => a.vault === "vault-b")?.amount ?? 0,
		);
	});

	test("caps total move size at MAX_ALLOCATION", () => {
		const input = makeInput({
			apy: { "vault-a": 0.01, "vault-b": 0.01, "vault-c": 0.5 },
			positions: { "vault-a": 500, "vault-b": 500, "vault-c": 0 },
			maxAllocation: 50,
		});

		const plan = planRebalance(input);
		const totalMove = plan.actions.reduce((sum, a) => sum + a.amount, 0);
		expect(totalMove).toBeLessThanOrEqual(50 + 1e-6);
		expect(plan.actions.length).toBeGreaterThan(0);
	});

	test("uses equal weights when all APYs are zero", () => {
		const input = makeInput({
			apy: { "vault-a": 0, "vault-b": 0, "vault-c": 0 },
			positions: { "vault-a": 150, "vault-b": 50, "vault-c": 100 },
			maxAllocation: 1000,
		});

		const plan = planRebalance(input, proportionalByApy);
		expect(plan.actions.length).toBeGreaterThan(0);
		expect(plan.actions.some((a) => a.vault === "vault-a" && a.kind === "withdraw")).toBe(true);
		expect(plan.actions.some((a) => a.vault === "vault-b" && a.kind === "deposit")).toBe(true);
	});

	test("returns no actions when already balanced", () => {
		const input = makeInput({
			apy: { "vault-a": 0.1, "vault-b": 0.1, "vault-c": 0.1 },
			positions: { "vault-a": 100, "vault-b": 100, "vault-c": 100 },
			maxAllocation: 1000,
			minMoveAmount: 0.001,
		});

		const plan = planRebalance(input);
		expect(plan.actions).toHaveLength(0);
	});

	test("orders withdraws before deposits", () => {
		const input = makeInput({
			apy: { "vault-a": 0.05, "vault-b": 0.1, "vault-c": 0.4 },
			positions: { "vault-a": 200, "vault-b": 100, "vault-c": 0 },
			maxAllocation: 500,
		});

		const plan = planRebalance(input);
		const firstDepositIndex = plan.actions.findIndex((a) => a.kind === "deposit");
		const lastWithdrawIndex = plan.actions.reduce(
			(last, action, index) => (action.kind === "withdraw" ? index : last),
			-1,
		);
		expect(lastWithdrawIndex).toBeLessThan(firstDepositIndex);
	});
});
