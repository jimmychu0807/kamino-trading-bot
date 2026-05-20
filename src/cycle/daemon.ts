import type { TransactionSigner } from "@solana/kit";
import type { RpcClients } from "../chain/rpc.ts";
import type { OperatorConfig } from "../config/schema.ts";
import type { AppDatabase } from "../db/client.ts";
import { startDriftTrigger } from "./drift-trigger.ts";
import { withCycleMutex } from "./mutex.ts";
import { type CycleResult, runCycle } from "./runner.ts";
import { scheduleInProcessCron } from "./schedule-cron.ts";

export type TradingBotRunOptions = {
	runForSecs?: number;
	cycleIntervalSecs?: number;
};

export type TradingBotContext = {
	config: OperatorConfig;
	clients: RpcClients;
	signer: TransactionSigner;
	db: AppDatabase;
};

function logCycleResult(result: CycleResult, previewMode: boolean): void {
	console.log(
		JSON.stringify(
			{
				cycleId: result.cycleId,
				status: result.status,
				outcome: result.decisionLog.outcome,
				rationale: result.decisionLog.rationale,
				plannedLegs: result.actions.length,
				previewMode,
			},
			null,
			2,
		),
	);
}

async function runScheduledCycle(ctx: TradingBotContext): Promise<void> {
	const result = await withCycleMutex(async () => {
		const abort = AbortSignal.timeout(ctx.config.cycleTimeoutMs);
		return runCycle({
			config: ctx.config,
			clients: ctx.clients,
			signer: ctx.signer,
			db: ctx.db,
			now: new Date(),
			abortSignal: abort,
		});
	});

	if (result === null) {
		console.log(JSON.stringify({ skipped: true, reason: "cycle_in_flight" }));
		return;
	}

	logCycleResult(result, ctx.config.previewMode);
}

/**
 * Runs the trading bot on a schedule until `runForSecs` elapses or the process
 * receives SIGINT/SIGTERM. Uses `cycleIntervalSecs` when set; otherwise
 * `config.cronExpression` via in-process cron scheduling (`Bun.cron.parse`).
 */
export async function startTradingBot(
	ctx: TradingBotContext,
	options: TradingBotRunOptions = {},
): Promise<void> {
	const stoppers: Array<() => void> = [];
	let shuttingDown = false;

	const shutdown = () => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		for (const stop of stoppers) {
			stop();
		}
	};

	if (options.cycleIntervalSecs !== undefined) {
		const intervalMs = options.cycleIntervalSecs * 1000;
		const timer = setInterval(() => {
			void runScheduledCycle(ctx);
		}, intervalMs);
		stoppers.push(() => clearInterval(timer));
	} else {
		const job = scheduleInProcessCron(ctx.config.cronExpression, () => {
			void runScheduledCycle(ctx);
		});
		stoppers.push(() => job.stop());
	}

	const driftTrigger = startDriftTrigger(ctx);
	stoppers.push(() => driftTrigger.stop());

	await runScheduledCycle(ctx);

	await new Promise<void>((resolve) => {
		const finish = () => {
			shutdown();
			resolve();
		};

		if (options.runForSecs !== undefined) {
			const timer = setTimeout(finish, options.runForSecs * 1000);
			stoppers.push(() => clearTimeout(timer));
		}

		process.once("SIGINT", finish);
		process.once("SIGTERM", finish);
	});
}
