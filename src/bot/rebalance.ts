import type { Address, TransactionSigner } from "@solana/kit";
import type { AllocationTracker, BotConfig } from "../config/types.ts";
import type { TransactionExecutor } from "../kamino/txExecutor.ts";
import type { VaultClient } from "../kamino/vaultClient.ts";
import type { YieldSource } from "../kamino/yieldSource.ts";
import type { WalletBalanceReader } from "../solana/walletBalances.ts";
import { formatPlan, planRebalance } from "../strategy/planRebalance.ts";

export type RebalanceCycleDeps = {
	config: BotConfig;
	yieldSource: YieldSource;
	vaultClient: VaultClient;
	txExecutor: TransactionExecutor;
	walletBalances: WalletBalanceReader;
	allocationTracker: AllocationTracker;
	user: Address;
	signer: TransactionSigner;
};

export async function rebalanceCycle(deps: RebalanceCycleDeps): Promise<void> {
	const {
		config,
		yieldSource,
		vaultClient,
		txExecutor,
		walletBalances,
		allocationTracker,
		user,
		signer,
	} = deps;
	const vaults = [...config.vaultAddresses];

	console.log(`--- rebalance starts (${formatDateTime(new Date())}) ---`);
	console.log(`[rebalance] Starting cycle for vaults: ${vaults.join(", ")}`);

	await vaultClient.preloadVaults(vaults);
	const [positions, apyByVault, liquidityByVault, balances] = await Promise.all([
		vaultClient.getPositions(user, vaults),
		yieldSource.getApys(vaults),
		vaultClient.getLiquidity(vaults),
		walletBalances.getBalances(user),
	]);

	for (const vault of vaults) {
		console.log(
			`[rebalance] ${vault}: APY=${((apyByVault.get(vault) ?? 0) * 100).toFixed(2)}%, liquidity=${(liquidityByVault.get(vault) ?? 0).toFixed(6)}, position=${positions.find((p) => p.vault === vault)?.tokenValue.toFixed(6) ?? "0"}`,
		);
	}

	const deployBudget = config.maxAllocation - allocationTracker.allocatedFromReserve;
	console.log(
		`[rebalance] Reserve deploy: ${allocationTracker.allocatedFromReserve.toFixed(6)} / ${config.maxAllocation.toFixed(6)} (${Math.max(0, deployBudget).toFixed(6)} remaining)`,
	);

	const plan = planRebalance({
		vaults,
		positions,
		apyByVault,
		liquidityByVault,
		usdcReserve: balances.usdc,
		allocatedFromReserve: allocationTracker.allocatedFromReserve,
		maxAllocation: config.maxAllocation,
		minMoveAmount: config.minMoveAmount,
	});

	console.log(`[rebalance] Plan:\n${formatPlan(plan)}`);

	if (plan.actions.length === 0) {
		console.log("[rebalance] Nothing to do.");
	} else if (config.dryRun) {
		console.log("[rebalance] DRY_RUN=true — skipping transaction execution.");
	} else {
		for (const action of plan.actions) {
			const label = `${action.kind} ${action.amount.toFixed(6)} ${action.vault}`;
			const bundle =
				action.kind === "deposit"
					? await vaultClient.buildDepositIxs(action.vault, signer, action.amount)
					: await vaultClient.buildWithdrawIxs(action.vault, signer, action.amount);

			await txExecutor.sendInstructions(bundle.instructions, label, bundle.lookupTableAddresses);

			if (action.kind === "deposit") {
				allocationTracker.allocatedFromReserve = Math.min(
					config.maxAllocation,
					allocationTracker.allocatedFromReserve + action.amount,
				);
			} else {
				allocationTracker.allocatedFromReserve = Math.max(
					0,
					allocationTracker.allocatedFromReserve - action.amount,
				);
			}
		}
	}

	console.log(`--- rebalance ends (${formatDateTime(new Date())}) ---`);
}

function formatDateTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
