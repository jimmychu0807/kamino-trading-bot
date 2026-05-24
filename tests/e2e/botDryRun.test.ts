import { describe, expect, test } from "bun:test";
import { address } from "@solana/kit";
import { BotRunner } from "../../src/bot/runner.ts";
import type { BotConfig } from "../../src/config/types.ts";
import type { TransactionExecutor } from "../../src/kamino/txExecutor.ts";
import type { VaultClient } from "../../src/kamino/vaultClient.ts";
import type { YieldSource } from "../../src/kamino/yieldSource.ts";

describe("bot dry-run e2e", () => {
	test("runs at least two dry-run cycles with planned actions", async () => {
		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
			originalLog(...args);
		};

		try {
			const config: BotConfig = {
				solanaRpc: "https://example.com",
				privateKey: "unused",
				vaultAddresses: ["vault-a", "vault-b", "vault-c"],
				maxAllocation: 50,
				durationSec: 5,
				intervalSec: 2,
				dryRun: true,
				minMoveAmount: 0,
			};

			let nowMs = 0;
			const yieldSource: YieldSource = {
				getApy: async () => 0.1,
				getApys: async (vaults) =>
					new Map([
						[vaults[0] ?? "vault-a", 0.05],
						[vaults[1] ?? "vault-b", 0.15],
						[vaults[2] ?? "vault-c", 0.3],
					]),
			};

			const vaultClient: VaultClient = {
				preloadVaults: async () => {},
				getPositions: async (_user, vaults) =>
					vaults.map((vault, index) => ({
						vault,
						tokenValue: index === 0 ? 200 : 50,
					})),
				getLiquidity: async (vaults) =>
					new Map(vaults.map((vault, index) => [vault, (index + 1) * 1_000_000])),
				buildDepositIxs: async () => {
					throw new Error("no chain writes in dry run");
				},
				buildWithdrawIxs: async () => {
					throw new Error("no chain writes in dry run");
				},
			};

			const txExecutor: TransactionExecutor = {
				sendInstructions: async () => {
					throw new Error("no chain writes in dry run");
				},
			};

			const runner = new BotRunner({
				config,
				yieldSource,
				vaultClient,
				txExecutor,
				user: address("11111111111111111111111111111111"),
				signer: { address: address("11111111111111111111111111111111") },
				now: () => nowMs,
				sleep: async (ms) => {
					nowMs += ms;
				},
			});

			const cycles = await runner.run();
			expect(cycles).toBeGreaterThanOrEqual(2);
			expect(logs.some((line) => line.includes("[rebalance] Plan:"))).toBe(true);
			expect(logs.some((line) => line.includes("DRY_RUN=true"))).toBe(true);
		} finally {
			console.log = originalLog;
		}
	});
});
