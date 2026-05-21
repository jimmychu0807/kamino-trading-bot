import { z } from "zod";

/** Base58 Solana address (32–44 chars, no 0/O/I/l). */
export const solanaAddressSchema = z
	.string()
	.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address");

export const riskProfileSchema = z.enum(["conservative", "balanced", "aggressive"]);

export type RiskProfile = z.infer<typeof riskProfileSchema>;

export const riskWeightsSchema = z.object({
	liquidity: z.number().min(0),
	utilization: z.number().min(0),
	concentration: z.number().min(0),
	volatility: z.number().min(0),
});

export type RiskWeights = z.infer<typeof riskWeightsSchema>;

export const RISK_PROFILE_PRESETS: Record<
	RiskProfile,
	{
		maxSingleVaultPct: number;
		cashBufferPct: number;
		criticalRiskFloor: number;
		minImprovementBps: number;
		cooldownMs: number;
		driftBandPct: number;
		riskWeights: RiskWeights;
	}
> = {
	conservative: {
		maxSingleVaultPct: 40,
		cashBufferPct: 5,
		criticalRiskFloor: 0.25,
		minImprovementBps: 35,
		cooldownMs: 6 * 60 * 60 * 1000,
		driftBandPct: 2,
		riskWeights: {
			liquidity: 0.35,
			utilization: 0.25,
			concentration: 0.25,
			volatility: 0.15,
		},
	},
	balanced: {
		maxSingleVaultPct: 50,
		cashBufferPct: 3,
		criticalRiskFloor: 0.2,
		minImprovementBps: 25,
		cooldownMs: 6 * 60 * 60 * 1000,
		driftBandPct: 2,
		riskWeights: {
			liquidity: 0.3,
			utilization: 0.25,
			concentration: 0.25,
			volatility: 0.2,
		},
	},
	aggressive: {
		maxSingleVaultPct: 60,
		cashBufferPct: 0,
		criticalRiskFloor: 0.15,
		minImprovementBps: 15,
		cooldownMs: 4 * 60 * 60 * 1000,
		driftBandPct: 3,
		riskWeights: {
			liquidity: 0.2,
			utilization: 0.25,
			concentration: 0.25,
			volatility: 0.3,
		},
	},
};

export const vaultConfigSchema = z.object({
	address: solanaAddressSchema,
	label: z.string().optional(),
	minAllocationPct: z.number().min(0).max(100).default(0),
	maxAllocationPct: z.number().min(0).max(100).optional(),
	enabled: z.boolean().default(true),
});

export type VaultConfig = z.infer<typeof vaultConfigSchema>;

const rebalancePolicyBaseSchema = z.object({
	profile: riskProfileSchema.default("balanced"),
	minImprovementBps: z.number().int().min(0).optional(),
	maxSingleVaultPct: z.number().min(1).max(100).optional(),
	minTradeSizeBase: z
		.union([z.string().regex(/^[0-9]+$/), z.bigint()])
		.transform((v) => (typeof v === "bigint" ? v : BigInt(v))),
	cooldownMs: z.number().int().min(0).optional(),
	driftBandPct: z.number().min(0).max(50).optional(),
	cashBufferPct: z.number().min(0).max(10).optional(),
	criticalRiskFloor: z.number().min(0).max(1).optional(),
	riskWeights: riskWeightsSchema.partial().optional(),
});

export const rebalancePolicySchema = rebalancePolicyBaseSchema.transform((raw) => {
	const preset = RISK_PROFILE_PRESETS[raw.profile];
	const weights = { ...preset.riskWeights, ...raw.riskWeights };
	return {
		profile: raw.profile,
		minImprovementBps: raw.minImprovementBps ?? preset.minImprovementBps,
		maxSingleVaultPct: raw.maxSingleVaultPct ?? preset.maxSingleVaultPct,
		minTradeSizeBase: raw.minTradeSizeBase,
		cooldownMs: raw.cooldownMs ?? preset.cooldownMs,
		driftBandPct: raw.driftBandPct ?? preset.driftBandPct,
		cashBufferPct: raw.cashBufferPct ?? preset.cashBufferPct,
		criticalRiskFloor: raw.criticalRiskFloor ?? preset.criticalRiskFloor,
		riskWeights: weights,
	};
});

export type RebalancePolicy = z.infer<typeof rebalancePolicySchema>;

const bigintBaseUnitsSchema = z
	.union([z.string().regex(/^[0-9]+$/), z.bigint()])
	.transform((v) => (typeof v === "bigint" ? v : BigInt(v)));

export const operatorConfigSchema = z
	.object({
		solanaRpc: z.string().url(),
		privateKey: z.string().min(1),
		walletAddress: solanaAddressSchema.optional(),
		vaults: z.array(vaultConfigSchema).length(3),
		policy: rebalancePolicyBaseSchema,
		maxAllocationBase: bigintBaseUnitsSchema.optional(),
		previewMode: z.boolean().default(true),
		driftTriggerEnabled: z.boolean().default(false),
		driftPollIntervalMs: z.number().int().min(60_000).default(300_000),
		metricsMaxAgeMs: z.number().int().min(60_000).default(900_000),
		rpcTimeoutMs: z.number().int().min(1_000).default(15_000),
		cycleTimeoutMs: z.number().int().min(30_000).default(180_000),
		legMaxAttempts: z.number().int().min(1).max(10).default(3),
		consecutiveFailureThreshold: z.number().int().min(1).default(3),
		apySpikeGuardMultiple: z.number().min(1).default(3),
		cronExpression: z.string().min(1).default("*/15 * * * *"),
		databaseUrl: z.string().min(1).default("./data/bot.sqlite"),
	})
	.transform((raw) => {
		const policy = rebalancePolicySchema.parse(raw.policy);
		const vaults = raw.vaults.map((v) => ({
			...v,
			maxAllocationPct: v.maxAllocationPct ?? policy.maxSingleVaultPct,
		}));
		return { ...raw, policy, vaults };
	})
	.superRefine((cfg, ctx) => {
		const addresses = cfg.vaults.map((v) => v.address);
		if (new Set(addresses).size !== addresses.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Vault addresses must be unique",
				path: ["vaults"],
			});
		}

		const minSum = cfg.vaults.reduce((s, v) => s + v.minAllocationPct, 0);
		if (minSum > 100) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Sum of minAllocationPct (${minSum}) must be ≤ 100`,
				path: ["vaults"],
			});
		}

		for (const [i, vault] of cfg.vaults.entries()) {
			const maxPct = vault.maxAllocationPct ?? cfg.policy.maxSingleVaultPct;
			if (maxPct < vault.minAllocationPct) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "maxAllocationPct must be ≥ minAllocationPct",
					path: ["vaults", i],
				});
			}
			if (maxPct > cfg.policy.maxSingleVaultPct) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `maxAllocationPct exceeds policy maxSingleVaultPct (${cfg.policy.maxSingleVaultPct})`,
					path: ["vaults", i, "maxAllocationPct"],
				});
			}
		}
	});

export type OperatorConfig = z.infer<typeof operatorConfigSchema>;

export function parseOperatorConfig(input: unknown): OperatorConfig {
	return operatorConfigSchema.parse(input);
}
