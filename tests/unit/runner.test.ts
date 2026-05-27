import { describe, expect, test } from "bun:test";
import { address } from "@solana/kit";
import { BotRunner, expectedCycleCount } from "../../src/bot/runner.ts";
import type { BotConfig } from "../../src/config/types.ts";
import type { TransactionExecutor } from "../../src/kamino/txExecutor.ts";
import type { VaultClient } from "../../src/kamino/vaultClient.ts";
import type { YieldSource } from "../../src/kamino/yieldSource.ts";

const config: BotConfig = {
	solanaRpc: "https://example.com",
	privateKey: "unused",
	vaultAddresses: ["v1", "v2", "v3"],
	maxAllocation: 100,
	durationSec: 10,
	intervalSec: 3,
	dryRun: true,
	minMoveAmount: 0,
};

describe("BotRunner", () => {
	test("expectedCycleCount uses floor division", () => {
		expect(expectedCycleCount(10, 3)).toBe(3);
		expect(expectedCycleCount(5, 2)).toBe(2);
		expect(expectedCycleCount(null, 3)).toBeNull();
	});

	test("logs wallet balances at startup", async () => {
		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
			originalLog(...args);
		};

		try {
			const yieldSource: YieldSource = {
				getApy: async () => 0.1,
				getApys: async (vaults) => new Map(vaults.map((v) => [v, 0.1])),
			};
			const vaultClient: VaultClient = {
				preloadVaults: async () => {},
				getPositions: async (_user, vaults) => vaults.map((vault) => ({ vault, tokenValue: 100 })),
				getLiquidity: async (vaults) => new Map(vaults.map((vault) => [vault, 1000])),
				buildDepositIxs: async () => [],
				buildWithdrawIxs: async () => [],
			};
			const runner = new BotRunner({
				config: { ...config, durationSec: 1, intervalSec: 10 },
				yieldSource,
				vaultClient,
				txExecutor: { sendInstructions: async () => {} },
				walletBalances: {
					getBalances: async () => ({ sol: 2.25, usdc: 42.5 }),
				},
				user: address("11111111111111111111111111111111"),
				signer: { address: address("11111111111111111111111111111111") },
			});

			await runner.run();
			expect(logs.some((line) => line.includes("wallet SOL=2.250000"))).toBe(true);
			expect(logs.some((line) => line.includes("USDC=42.500000"))).toBe(true);
		} finally {
			console.log = originalLog;
		}
	});

	test("runs exactly floor(duration/interval) cycles", async () => {
		let nowMs = 0;
		const sleepCalls: number[] = [];

		const yieldSource: YieldSource = {
			getApy: async () => 0.1,
			getApys: async (vaults) => new Map(vaults.map((v) => [v, 0.1])),
		};

		const vaultClient: VaultClient = {
			preloadVaults: async () => {},
			getPositions: async (_user, vaults) => vaults.map((vault) => ({ vault, tokenValue: 100 })),
			getLiquidity: async (vaults) => new Map(vaults.map((vault) => [vault, 1000])),
			buildDepositIxs: async () => [],
			buildWithdrawIxs: async () => [],
		};

		const txExecutor: TransactionExecutor = {
			sendInstructions: async () => {
				throw new Error("should not send in dry run");
			},
		};

		const runner = new BotRunner({
			config,
			yieldSource,
			vaultClient,
			txExecutor,
			walletBalances: {
				getBalances: async () => ({ sol: 1.5, usdc: 100 }),
			},
			user: address("11111111111111111111111111111111"),
			signer: { address: address("11111111111111111111111111111111") },
			now: () => nowMs,
			sleep: async (ms) => {
				sleepCalls.push(ms);
				nowMs += ms;
			},
		});

		const cycles = await runner.run();
		expect(cycles).toBe(3);
		expect(sleepCalls).toEqual([3000, 3000]);
	});
});
