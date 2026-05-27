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

/** Tracks how much of the reserve budget has been deployed into vaults. */
export type AllocationTracker = {
	allocatedFromReserve: number;
};

export type RebalanceInput = {
	vaults: VaultId[];
	positions: VaultPosition[];
	apyByVault: Map<VaultId, number>;
	liquidityByVault: Map<VaultId, number>;
	/** Wallet USDC available to deploy from reserve. */
	usdcReserve: number;
	/** Reserve principal already in vaults (excludes yield above this baseline). */
	allocatedFromReserve: number;
	/** Max reserve principal that may be deployed across all vaults. */
	maxAllocation: number;
	minMoveAmount: number;
};

export type CliOverrides = {
	durationSec?: number;
	intervalSec?: number;
};
