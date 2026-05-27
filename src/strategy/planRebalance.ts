import type { RebalanceAction, RebalanceInput, RebalancePlan, VaultId } from "../config/types.ts";

export type AllocationStrategy = (input: RebalanceInput) => RebalancePlan;

function positionMap(positions: RebalanceInput["positions"]): Map<VaultId, number> {
	return new Map(positions.map((p) => [p.vault, p.tokenValue]));
}

function computeWeights(vaults: VaultId[], apyByVault: Map<VaultId, number>): Map<VaultId, number> {
	const apys = vaults.map((vault) => apyByVault.get(vault) ?? 0);
	const apySum = apys.reduce((sum, apy) => sum + apy, 0);
	const weights = new Map<VaultId, number>();

	if (apySum <= 0) {
		const equalWeight = 1 / vaults.length;
		for (const vault of vaults) {
			weights.set(vault, equalWeight);
		}
		return weights;
	}

	for (let i = 0; i < vaults.length; i++) {
		const vault = vaults[i];
		const apy = apys[i];
		if (vault !== undefined && apy !== undefined) {
			weights.set(vault, apy / apySum);
		}
	}
	return weights;
}

export function remainingReserveDeployBudget(
	maxAllocation: number,
	allocatedFromReserve: number,
): number {
	return Math.max(0, maxAllocation - allocatedFromReserve);
}

export function initialAllocatedFromReserve(
	startupVaultTotal: number,
	maxAllocation: number,
): number {
	return Math.min(startupVaultTotal, maxAllocation);
}

/** Cap net deposits that would draw new principal from wallet reserve. */
export function capNetDepositsByBudget(
	deltas: Map<VaultId, number>,
	maxNetDeposit: number,
): Map<VaultId, number> {
	if (maxNetDeposit <= 0) {
		let totalWithdraw = 0;
		let totalDeposit = 0;
		for (const delta of deltas.values()) {
			if (delta < 0) {
				totalWithdraw += -delta;
			} else if (delta > 0) {
				totalDeposit += delta;
			}
		}
		if (totalDeposit <= totalWithdraw) {
			return deltas;
		}
		maxNetDeposit = 0;
	}

	let totalWithdraw = 0;
	let totalDeposit = 0;
	for (const delta of deltas.values()) {
		if (delta < 0) {
			totalWithdraw += -delta;
		} else if (delta > 0) {
			totalDeposit += delta;
		}
	}

	const netDeposit = totalDeposit - totalWithdraw;
	if (netDeposit <= maxNetDeposit) {
		return deltas;
	}

	const allowedDeposit = totalWithdraw + maxNetDeposit;
	const scale = allowedDeposit / totalDeposit;
	const capped = new Map<VaultId, number>();
	for (const [vault, delta] of deltas) {
		if (delta > 0) {
			capped.set(vault, delta * scale);
		} else {
			capped.set(vault, delta);
		}
	}
	return capped;
}

function buildActions(deltas: Map<VaultId, number>, minMoveAmount: number): RebalanceAction[] {
	const withdraws: RebalanceAction[] = [];
	const deposits: RebalanceAction[] = [];

	for (const [vault, delta] of deltas) {
		const amount = Math.abs(delta);
		if (amount < minMoveAmount) {
			continue;
		}
		if (delta < 0) {
			withdraws.push({ vault, kind: "withdraw", amount });
		} else if (delta > 0) {
			deposits.push({ vault, kind: "deposit", amount });
		}
	}

	return [...withdraws, ...deposits];
}

export const proportionalByApy: AllocationStrategy = (input) => {
	const positions = positionMap(input.positions);
	const vaultTotal = input.positions.reduce((sum, position) => sum + position.tokenValue, 0);
	const deployBudget = remainingReserveDeployBudget(
		input.maxAllocation,
		input.allocatedFromReserve,
	);
	const maxNetDeposit = Math.min(deployBudget, input.usdcReserve);
	const weights = computeWeights(input.vaults, input.apyByVault);

	if (vaultTotal === 0) {
		if (maxNetDeposit <= 0) {
			return { actions: [] };
		}
		const rawDeltas = new Map<VaultId, number>();
		for (const vault of input.vaults) {
			rawDeltas.set(vault, maxNetDeposit * (weights.get(vault) ?? 0));
		}
		const cappedDeltas = capNetDepositsByBudget(rawDeltas, maxNetDeposit);
		return { actions: buildActions(cappedDeltas, input.minMoveAmount) };
	}

	const rawDeltas = new Map<VaultId, number>();
	for (const vault of input.vaults) {
		const current = positions.get(vault) ?? 0;
		const target = vaultTotal * (weights.get(vault) ?? 0);
		rawDeltas.set(vault, target - current);
	}

	const cappedDeltas = capNetDepositsByBudget(rawDeltas, maxNetDeposit);
	return { actions: buildActions(cappedDeltas, input.minMoveAmount) };
};

export function planRebalance(
	input: RebalanceInput,
	strategy: AllocationStrategy = proportionalByApy,
): RebalancePlan {
	return strategy(input);
}

export function formatPlan(plan: RebalancePlan): string {
	if (plan.actions.length === 0) {
		return "No rebalance actions planned.";
	}
	return plan.actions
		.map((action) => `  - ${action.kind} ${action.amount.toFixed(6)} into ${action.vault}`)
		.join("\n");
}
