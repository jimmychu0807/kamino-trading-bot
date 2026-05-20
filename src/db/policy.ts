import { createHash } from "node:crypto";
import type { RebalancePolicy } from "../config/schema.ts";
import type { AppDatabase } from "./client.ts";
import { policySnapshots } from "./schema.ts";

export function hashPolicySnapshot(policy: RebalancePolicy): string {
	const normalized = stableStringify(policy);
	return createHash("sha256").update(normalized).digest("hex");
}

export async function writePolicySnapshot(
	db: AppDatabase,
	params: {
		cycleId: string;
		policy: RebalancePolicy;
		now?: Date;
	},
): Promise<{ cycleId: string; policyHash: string }> {
	const createdAt = (params.now ?? new Date()).toISOString();
	const policyJson = stableStringify(params.policy);
	const policyHash = hashPolicySnapshot(params.policy);

	await db
		.insert(policySnapshots)
		.values({
			cycleId: params.cycleId,
			policyHash,
			policyJson,
			createdAt,
		})
		.onConflictDoUpdate({
			target: policySnapshots.cycleId,
			set: {
				policyHash,
				policyJson,
				createdAt,
			},
		});

	return { cycleId: params.cycleId, policyHash };
}

function stableStringify(value: unknown): string {
	if (value === null || value === undefined) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		return `{${entries
			.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
			.join(",")}}`;
	}
	if (typeof value === "bigint") {
		return JSON.stringify(value.toString());
	}
	return JSON.stringify(value);
}
