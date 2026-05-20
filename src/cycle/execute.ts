import type { Instruction, Signature, TransactionSigner } from "@solana/kit";
import Decimal from "decimal.js";
import type { RpcClients } from "../chain/rpc.ts";
import { buildAndSendInstructions } from "../chain/tx.ts";
import type { WalletPosition } from "../kamino/reconcile.ts";
import { createVaultClient } from "../kamino/vault.ts";
import type { TargetAllocation } from "../strategy/types.ts";
import type { ShouldRebalanceResult } from "../strategy/warrant.ts";

export type RebalanceAction = {
	vaultAddress: string;
	kind: "withdraw" | "deposit";
	phase: "withdrawal" | "deposit";
	amountBase: bigint;
};

export type PlanRebalanceActionsInput = {
	position: WalletPosition;
	targets: TargetAllocation[];
	warrant: ShouldRebalanceResult;
};

export type RebalanceExecutionStatus = "completed" | "partial";

export type ExecutedRebalanceAction = RebalanceAction & {
	status: "confirmed" | "failed";
	signature: Signature | null;
	attempts: number;
	error?: string;
};

export type ExecuteRebalanceResult = {
	status: RebalanceExecutionStatus;
	actions: ExecutedRebalanceAction[];
};

export type VaultIxBuilder = {
	withdrawIxs: (
		signer: TransactionSigner,
		amountBase: bigint | Decimal,
	) => Promise<Instruction[]>;
	depositIxs: (
		signer: TransactionSigner,
		amountBase: bigint | Decimal,
	) => Promise<Instruction[]>;
};

export type BuildActionInstructionsContext = {
	signer: TransactionSigner;
	createVaultIxBuilder?: (
		vaultAddress: string,
		clients: RpcClients,
	) => VaultIxBuilder;
	clients: RpcClients;
};

export type ExecuteRebalanceActionsInput = {
	clients: RpcClients;
	signer: TransactionSigner;
	actions: RebalanceAction[];
	createVaultIxBuilder?: (
		vaultAddress: string,
		clients: RpcClients,
	) => VaultIxBuilder;
	sendInstructions?: (
		clients: RpcClients,
		signer: TransactionSigner,
		instructions: Instruction[],
	) => Promise<{ signature: Signature; attempts: number }>;
};

function defaultVaultIxBuilder(
	vaultAddress: string,
	clients: RpcClients,
): VaultIxBuilder {
	const vault = createVaultClient(clients.rpc, vaultAddress);

	const toSdkAmount = (amountBase: bigint | Decimal): Decimal =>
		amountBase instanceof Decimal
			? amountBase
			: new Decimal(amountBase.toString());

	return {
		withdrawIxs: async (signer, amountBase) => {
			const result = await (vault as unknown as {
				withdrawIxs: (
					user: TransactionSigner,
					shareAmount: Decimal,
				) => Promise<{
					unstakeFromFarmIfNeededIxs: Instruction[];
					withdrawIxs: Instruction[];
					postWithdrawIxs: Instruction[];
				}>;
			}).withdrawIxs(signer, toSdkAmount(amountBase));
			return [
				...result.unstakeFromFarmIfNeededIxs,
				...result.withdrawIxs,
				...result.postWithdrawIxs,
			];
		},
		depositIxs: async (signer, amountBase) => {
			const result = await (vault as unknown as {
				depositIxs: (
					user: TransactionSigner,
					tokenAmount: Decimal,
				) => Promise<{
					depositIxs: Instruction[];
					stakeInFarmIfNeededIxs: Instruction[];
					stakeInFlcFarmIfNeededIxs: Instruction[];
				}>;
			}).depositIxs(signer, toSdkAmount(amountBase));
			return [
				...result.depositIxs,
				...result.stakeInFarmIfNeededIxs,
				...result.stakeInFlcFarmIfNeededIxs,
			];
		},
	};
}

function currentValueByVault(position: WalletPosition): Map<string, bigint> {
	return new Map(
		position.vaultShares.map((share) => [share.vaultAddress, share.valueBase]),
	);
}

export function planRebalanceActions(
	input: PlanRebalanceActionsInput,
): RebalanceAction[] {
	if (!input.warrant.shouldRebalance) {
		return [];
	}

	const currentByVault = currentValueByVault(input.position);
	const withdrawals: RebalanceAction[] = [];
	const deposits: RebalanceAction[] = [];

	for (const target of input.targets) {
		const currentBase = currentByVault.get(target.vaultAddress) ?? 0n;
		const delta = target.targetAmount - currentBase;
		if (delta < 0n) {
			withdrawals.push({
				vaultAddress: target.vaultAddress,
				kind: "withdraw",
				phase: "withdrawal",
				amountBase: -delta,
			});
			continue;
		}
		if (delta > 0n) {
			deposits.push({
				vaultAddress: target.vaultAddress,
				kind: "deposit",
				phase: "deposit",
				amountBase: delta,
			});
		}
	}

	withdrawals.sort((a, b) => Number(b.amountBase - a.amountBase));
	deposits.sort((a, b) => Number(b.amountBase - a.amountBase));

	return [...withdrawals, ...deposits];
}

export async function buildActionInstructions(
	action: RebalanceAction,
	ctx: BuildActionInstructionsContext,
): Promise<Instruction[]> {
	const builder =
		ctx.createVaultIxBuilder?.(action.vaultAddress, ctx.clients) ??
		defaultVaultIxBuilder(action.vaultAddress, ctx.clients);
	if (action.kind === "withdraw") {
		return builder.withdrawIxs(ctx.signer, action.amountBase);
	}
	return builder.depositIxs(ctx.signer, action.amountBase);
}

export async function executeRebalanceActions(
	input: ExecuteRebalanceActionsInput,
): Promise<ExecuteRebalanceResult> {
	const sendInstructions = input.sendInstructions ?? buildAndSendInstructions;
	const executed: ExecutedRebalanceAction[] = [];

	for (const action of input.actions) {
		try {
			const instructions = await buildActionInstructions(action, {
				signer: input.signer,
				clients: input.clients,
				createVaultIxBuilder: input.createVaultIxBuilder,
			});

			const sendResult = await sendInstructions(
				input.clients,
				input.signer,
				instructions,
			);
			executed.push({
				...action,
				status: "confirmed",
				signature: sendResult.signature,
				attempts: sendResult.attempts,
			});
		} catch (error) {
			executed.push({
				...action,
				status: "failed",
				signature: null,
				attempts: 1,
				error: error instanceof Error ? error.message : String(error),
			});
			// FR-011: stop immediately on partial leg failure, no same-cycle retries.
			return { status: "partial", actions: executed };
		}
	}

	return { status: "completed", actions: executed };
}
