import { describe, expect, test } from "bun:test";
import {
	initialAllocatedFromReserve,
	planRebalance,
	proportionalByApy,
	remainingReserveDeployBudget,
} from "../../src/strategy/planRebalance.ts";

const VAULTS = ["vault-a", "vault-b", "vault-c"] as const;

function makeInput(overrides: {
	apy?: Record<string, number>;
	positions?: Record<string, number>;
	usdcReserve?: number;
	allocatedFromReserve?: number;
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
		liquidityByVault: new Map(VAULTS.map((vault) => [vault, 1_000_000])),
		usdcReserve: overrides.usdcReserve ?? 0,
		allocatedFromReserve: overrides.allocatedFromReserve ?? 0,
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

	test("deploys deploy budget proportionally when no vault positions", () => {
		const input = makeInput({
			apy: { "vault-a": 0.1, "vault-b": 0.2, "vault-c": 0.3 },
			positions: { "vault-a": 0, "vault-b": 0, "vault-c": 0 },
			usdcReserve: 1000,
			maxAllocation: 1000,
			allocatedFromReserve: 0,
		});

		const plan = planRebalance(input);
		const deposits = plan.actions.filter((a) => a.kind === "deposit");

		expect(plan.actions.every((a) => a.kind === "deposit")).toBe(true);
		expect(deposits).toHaveLength(3);
		expect(deposits.find((a) => a.vault === "vault-a")?.amount).toBeCloseTo(1000 / 6, 4);
		expect(deposits.find((a) => a.vault === "vault-b")?.amount).toBeCloseTo(2000 / 6, 4);
		expect(deposits.find((a) => a.vault === "vault-c")?.amount).toBeCloseTo(3000 / 6, 4);
		expect(deposits.reduce((sum, a) => sum + a.amount, 0)).toBeCloseTo(1000, 4);
	});

	test("initial deploy is capped by wallet USDC when reserve exceeds balance", () => {
		const input = makeInput({
			apy: { "vault-a": 0.1, "vault-b": 0.2, "vault-c": 0.3 },
			positions: { "vault-a": 0, "vault-b": 0, "vault-c": 0 },
			usdcReserve: 300,
			maxAllocation: 1000,
		});

		const plan = planRebalance(input);
		const totalDeposit = plan.actions
			.filter((a) => a.kind === "deposit")
			.reduce((sum, a) => sum + a.amount, 0);

		expect(totalDeposit).toBeCloseTo(300, 4);
	});

	test("returns no actions on cold start when deploy budget is exhausted", () => {
		const input = makeInput({
			positions: { "vault-a": 0, "vault-b": 0, "vault-c": 0 },
			usdcReserve: 1000,
			allocatedFromReserve: 1000,
			maxAllocation: 1000,
		});

		const plan = planRebalance(input);
		expect(plan.actions).toHaveLength(0);
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

	test("does not withdraw yield growth when all value is in the highest-APY vault", () => {
		const input = makeInput({
			apy: { "vault-a": 0.5, "vault-b": 0, "vault-c": 0 },
			positions: { "vault-a": 12, "vault-b": 0, "vault-c": 0 },
			allocatedFromReserve: 8,
			maxAllocation: 10,
			usdcReserve: 0,
		});

		const plan = planRebalance(input);
		expect(plan.actions).toHaveLength(0);
	});

	test("rebalances across vaults without requiring reserve budget when net deposit is zero", () => {
		const input = makeInput({
			apy: { "vault-a": 0.01, "vault-b": 0.01, "vault-c": 0.98 },
			positions: { "vault-a": 12, "vault-b": 0, "vault-c": 0 },
			allocatedFromReserve: 8,
			maxAllocation: 10,
			usdcReserve: 0,
		});

		const plan = planRebalance(input);
		const totalDeposit = plan.actions
			.filter((a) => a.kind === "deposit")
			.reduce((sum, a) => sum + a.amount, 0);
		const totalWithdraw = plan.actions
			.filter((a) => a.kind === "withdraw")
			.reduce((sum, a) => sum + a.amount, 0);

		expect(totalWithdraw).toBeGreaterThan(0);
		expect(totalDeposit).toBeCloseTo(totalWithdraw, 4);
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

describe("reserve deploy budget", () => {
	test("initialAllocatedFromReserve uses startup vault principal", () => {
		expect(initialAllocatedFromReserve(8, 10)).toBe(8);
		expect(initialAllocatedFromReserve(12, 10)).toBe(10);
	});

	test("remainingReserveDeployBudget", () => {
		expect(remainingReserveDeployBudget(10, 8)).toBe(2);
		expect(remainingReserveDeployBudget(10, 12)).toBe(0);
	});
});
