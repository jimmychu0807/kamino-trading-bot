import type { VaultId } from "../config/types.ts";

const KAMINO_API_BASE = "https://api.kamino.finance";

export interface YieldSource {
	getApy(vault: VaultId): Promise<number>;
	getApys(vaults: VaultId[]): Promise<Map<VaultId, number>>;
}

type VaultMetricsResponse = {
	apy24h?: string;
	apy7d?: string;
};

export class KaminoApiYieldSource implements YieldSource {
	constructor(private readonly baseUrl = KAMINO_API_BASE) {}

	async getApy(vault: VaultId): Promise<number> {
		const metrics = await this.fetchMetrics(vault);
		return this.extractApy(metrics);
	}

	async getApys(vaults: VaultId[]): Promise<Map<VaultId, number>> {
		const entries = await Promise.all(
			vaults.map(async (vault) => [vault, await this.getApy(vault)] as const),
		);
		return new Map(entries);
	}

	private async fetchMetrics(vault: VaultId): Promise<VaultMetricsResponse> {
		const response = await fetch(`${this.baseUrl}/kvaults/vaults/${vault}/metrics`);
		if (!response.ok) {
			throw new Error(
				`Kamino API error for vault ${vault}: ${response.status} ${response.statusText}`,
			);
		}
		return (await response.json()) as VaultMetricsResponse;
	}

	private extractApy(metrics: VaultMetricsResponse): number {
		const raw = metrics.apy24h ?? metrics.apy7d ?? "0";
		const apy = Number(raw);
		if (!Number.isFinite(apy) || apy < 0) {
			return 0;
		}
		return apy;
	}
}
