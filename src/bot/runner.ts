import type { BotConfig } from "../config/types.ts";
import { type RebalanceCycleDeps, rebalanceCycle } from "./rebalance.ts";

export type BotRunnerDeps = Omit<RebalanceCycleDeps, "config"> & {
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
		const { config } = this.deps;
		const now = this.deps.now ?? Date.now;
		const sleep = this.deps.sleep ?? defaultSleep;
		const startMs = now();
		const endMs = config.durationSec === null ? null : startMs + config.durationSec * 1000;

		console.log(
			`Bot starting: interval=${config.intervalSec}s, duration=${config.durationSec ?? "indefinite"}s, dryRun=${config.dryRun}`,
		);

		const maxCycles = expectedCycleCount(config.durationSec, config.intervalSec);

		while (!this.stopped) {
			if (maxCycles !== null && this.cycleCount >= maxCycles) {
				break;
			}
			if (endMs !== null && now() >= endMs) {
				break;
			}

			await rebalanceCycle({ ...this.deps, config });
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
