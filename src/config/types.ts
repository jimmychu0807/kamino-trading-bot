export type VaultId = string;

export type BotConfig = {
	solanaRpc: string;
	privateKey: string;
	vaultAddresses: [VaultId, ...VaultId[]];
	maxAllocation: number;
	durationSec: number | null;
	intervalSec: number;
	dryRun: boolean;
	minMoveAmount: number;
};

export type RebalanceActionKind = "deposit" | "withdraw";

export type RebalanceAction = {
	vault: VaultId;
	kind: RebalanceActionKind;
	amount: number;
};

export type RebalancePlan = {
	actions: RebalanceAction[];
};

export type VaultApy = {
	vault: VaultId;
	apy: number;
};

export type VaultPosition = {
	vault: VaultId;
	tokenValue: number;
};

export type RebalanceInput = {
	vaults: VaultId[];
	apyByVault: Map<VaultId, number>;
	positions: VaultPosition[];
	maxAllocation: number;
	minMoveAmount: number;
};

export type CliOverrides = {
	durationSec?: number;
	intervalSec?: number;
};
