import type { Address, TransactionSigner } from "@solana/kit";
import type { BotConfig } from "../config/types.ts";
import type { TransactionExecutor } from "../kamino/txExecutor.ts";
import type { VaultClient } from "../kamino/vaultClient.ts";
import type { YieldSource } from "../kamino/yieldSource.ts";
import { formatPlan, planRebalance } from "../strategy/planRebalance.ts";

export type RebalanceCycleDeps = {
	config: BotConfig;
	yieldSource: YieldSource;
	vaultClient: VaultClient;
	txExecutor: TransactionExecutor;
	user: Address;
	signer: TransactionSigner;
};

export async function rebalanceCycle(deps: RebalanceCycleDeps): Promise<void> {
	const { config, yieldSource, vaultClient, txExecutor, user, signer } = deps;
	const vaults = [...config.vaultAddresses];

	console.log(`[rebalance] Starting cycle for vaults: ${vaults.join(", ")}`);

	await vaultClient.preloadVaults(vaults);
	const apyByVault = await yieldSource.getApys(vaults);
	const positions = await vaultClient.getPositions(user, vaults);

	for (const vault of vaults) {
		console.log(
			`[rebalance] ${vault}: APY=${((apyByVault.get(vault) ?? 0) * 100).toFixed(2)}%, position=${positions.find((p) => p.vault === vault)?.tokenValue.toFixed(6) ?? "0"}`,
		);
	}

	const plan = planRebalance({
		vaults,
		apyByVault,
		positions,
		maxAllocation: config.maxAllocation,
		minMoveAmount: config.minMoveAmount,
	});

	console.log(`[rebalance] Plan: ${formatPlan(plan)}`);

	if (plan.actions.length === 0) {
		console.log("[rebalance] Nothing to do.");
		return;
	}

	if (config.dryRun) {
		console.log("[rebalance] DRY_RUN=true — skipping transaction execution.");
		return;
	}

	for (const action of plan.actions) {
		const label = `${action.kind} ${action.amount.toFixed(6)} ${action.vault}`;
		const instructions =
			action.kind === "deposit"
				? await vaultClient.buildDepositIxs(action.vault, signer, action.amount)
				: await vaultClient.buildWithdrawIxs(action.vault, signer, action.amount);
		await txExecutor.sendInstructions(instructions, label);
	}
}
