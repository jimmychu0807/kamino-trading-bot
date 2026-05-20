/** Point-in-time vault metrics for scoring (FR-002). */
export type ReserveWeight = {
	reserveAddress: string;
	weightPct: number;
};

export type VaultMetricsSnapshot = {
	vaultAddress: string;
	capturedAt: Date;
	netApy: number;
	tvlUsd: number;
	utilization: number | null;
	reserveWeights: ReserveWeight[];
	yieldVolatility: number;
	source: "chain" | "api";
	fresh: boolean;
};

/** Per-vault risk assessment (FR-003). */
export type RiskScore = {
	vaultAddress: string;
	liquidityScore: number;
	utilizationScore: number;
	concentrationScore: number;
	volatilityScore: number;
	composite: number;
	critical: boolean;
};

/** Desired deployable capital split (FR-005). */
export type TargetAllocation = {
	vaultAddress: string;
	targetPct: number;
	targetAmount: bigint;
	attractiveness: number;
};
