import { and, asc, gte, inArray, lte } from "drizzle-orm";
import {
	payloadToSnapshot,
	snapshotToPayload,
	type VaultMetricsSnapshotPayload,
	vaultMetricsSnapshotPayloadSchema,
} from "../kamino/metrics-history.ts";
import type { VaultMetricsSnapshot } from "../strategy/types.ts";
import type { AppDatabase } from "./client.ts";
import { metricSnapshots } from "./schema.ts";

export type PersistMetricSnapshotsOptions = {
	cycleId?: string | null;
};

export async function persistMetricSnapshots(
	db: AppDatabase,
	snapshots: VaultMetricsSnapshot[],
	options: PersistMetricSnapshotsOptions = {},
): Promise<number> {
	if (snapshots.length === 0) return 0;

	await db.insert(metricSnapshots).values(
		snapshots.map((snapshot) => ({
			id: crypto.randomUUID(),
			cycleId: options.cycleId ?? null,
			vaultAddress: snapshot.vaultAddress,
			capturedAt: snapshot.capturedAt.toISOString(),
			payloadJson: JSON.stringify(snapshotToPayload(snapshot)),
		})),
	);

	return snapshots.length;
}

export function parseStoredMetricSnapshot(row: {
	vaultAddress: string;
	capturedAt: string;
	payloadJson: string;
}): VaultMetricsSnapshot {
	const payload = vaultMetricsSnapshotPayloadSchema.parse(JSON.parse(row.payloadJson));
	return payloadToSnapshot({
		...payload,
		vaultAddress: row.vaultAddress,
		capturedAt: row.capturedAt,
	});
}

export type MetricSnapshotQuery = {
	vaultAddresses: string[];
	start?: Date;
	end?: Date;
};

export async function loadMetricSnapshots(
	db: AppDatabase,
	query: MetricSnapshotQuery,
): Promise<VaultMetricsSnapshot[]> {
	const conditions = [inArray(metricSnapshots.vaultAddress, query.vaultAddresses)];
	if (query.start) {
		conditions.push(gte(metricSnapshots.capturedAt, query.start.toISOString()));
	}
	if (query.end) {
		conditions.push(lte(metricSnapshots.capturedAt, query.end.toISOString()));
	}

	const rows = await db
		.select({
			vaultAddress: metricSnapshots.vaultAddress,
			capturedAt: metricSnapshots.capturedAt,
			payloadJson: metricSnapshots.payloadJson,
		})
		.from(metricSnapshots)
		.where(and(...conditions))
		.orderBy(asc(metricSnapshots.capturedAt));

	return rows.map(parseStoredMetricSnapshot);
}

/** Align snapshots that share the same capture instant across all vaults. */
export function groupSnapshotsByTimestamp(
	snapshots: VaultMetricsSnapshot[],
	vaultAddresses: string[],
): VaultMetricsSnapshot[][] {
	const required = new Set(vaultAddresses);
	const byTime = new Map<string, Map<string, VaultMetricsSnapshot>>();

	for (const snapshot of snapshots) {
		const key = snapshot.capturedAt.toISOString();
		let group = byTime.get(key);
		if (!group) {
			group = new Map();
			byTime.set(key, group);
		}
		group.set(snapshot.vaultAddress, snapshot);
	}

	const aligned: VaultMetricsSnapshot[][] = [];
	for (const [, group] of [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		if ([...required].every((vault) => group.has(vault))) {
			const row: VaultMetricsSnapshot[] = [];
			let complete = true;
			for (const vault of vaultAddresses) {
				const snapshot = group.get(vault);
				if (!snapshot) {
					complete = false;
					break;
				}
				row.push(snapshot);
			}
			if (complete) aligned.push(row);
		}
	}

	return aligned;
}

export function payloadFromSnapshot(snapshot: VaultMetricsSnapshot): VaultMetricsSnapshotPayload {
	return snapshotToPayload(snapshot);
}
