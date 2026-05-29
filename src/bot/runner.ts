import type { AllocationTracker, BotConfig } from "../config/types.ts";
import { initialAllocatedFromReserve } from "../strategy/planRebalance.ts";
import { type RebalanceCycleDeps, rebalanceCycle } from "./rebalance.ts";

export type BotRunnerDeps = Omit<RebalanceCycleDeps, "config" | "allocationTracker"> & {
	config: BotConfig;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function expectedCycleCount(durationSec: number | null, intervalSec: number): number | null {
	if (durationSec === null) {
		return null;
	}
	return Math.floor(durationSec / intervalSec);
}

export class BotRunner {
	private cycleCount = 0;
	private stopped = false;

	constructor(private readonly deps: BotRunnerDeps) {}

	getCycleCount(): number {
		return this.cycleCount;
	}

	stop(): void {
		this.stopped = true;
	}

	async run(): Promise<number> {
		const { config, walletBalances, user } = this.deps;
		const now = this.deps.now ?? Date.now;
		const sleep = this.deps.sleep ?? defaultSleep;
		const startMs = now();
		const endMs = config.durationSec === null ? null : startMs + config.durationSec * 1000;

		const balances = await walletBalances.getBalances(user);
		const vaults = [...config.vaultAddresses];
		await this.deps.vaultClient.preloadVaults(vaults);
		const startupPositions = await this.deps.vaultClient.getPositions(user, vaults);
		const startupVaultTotal = startupPositions.reduce(
			(sum, position) => sum + position.tokenValue,
			0,
		);
		const allocationTracker: AllocationTracker = {
			allocatedFromReserve: initialAllocatedFromReserve(startupVaultTotal, config.maxAllocation),
		};

		console.log(
			`Bot starting: interval=${config.intervalSec}s, duration=${config.durationSec ?? "indefinite"}s, dryRun=${config.dryRun}, wallet SOL=${balances.sol.toFixed(6)}, USDC=${balances.usdc.toFixed(6)}, vault total=${startupVaultTotal.toFixed(6)}, reserve deployed=${allocationTracker.allocatedFromReserve.toFixed(6)}/${config.maxAllocation.toFixed(6)}`,
		);

		const maxCycles = expectedCycleCount(config.durationSec, config.intervalSec);

		while (!this.stopped) {
			if (maxCycles !== null && this.cycleCount >= maxCycles) {
				break;
			}
			if (endMs !== null && now() >= endMs) {
				break;
			}

			await rebalanceCycle({ ...this.deps, config, allocationTracker });
			this.cycleCount++;

			if (maxCycles !== null && this.cycleCount >= maxCycles) {
				break;
			}
			if (endMs !== null && now() >= endMs) {
				break;
			}
			if (this.stopped) {
				break;
			}

			await sleep(config.intervalSec * 1000);
		}

		console.log(`Bot finished after ${this.cycleCount} cycle(s).`);
		return this.cycleCount;
	}
}
