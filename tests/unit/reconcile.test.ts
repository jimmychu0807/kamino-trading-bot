import { describe, expect, test } from "bun:test";
import Decimal from "decimal.js";
import { reconcilePositions } from "../../src/kamino/reconcile.ts";
import { VAULT_A, VAULT_B, VAULT_C } from "../helpers/cycle-fixtures.ts";

const clients = { rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 };
const wallet = "wallet-addr";

function makeReaders(
	readers: Record<
		string,
		{
			shares: unknown;
			rate: unknown;
		}
	>,
) {
	return {
		createVaultReader: (_c: typeof clients, vaultAddress: string) => ({
			getUserShares: async () => readers[vaultAddress]?.shares ?? 0n,
			getExchangeRate: async () => readers[vaultAddress]?.rate ?? 1,
		}),
	};
}

describe("reconcilePositions", () => {
	test("parses { totalShares } object and Decimal exchange rate", async () => {
		const position = await reconcilePositions({
			clients,
			walletAddress: wallet,
			vaultAddresses: [VAULT_A],
			resolveWalletTokenBalanceBase: async () => 0n,
			...makeReaders({
				[VAULT_A]: {
					shares: { totalShares: "100" },
					rate: new Decimal("1.5"),
				},
			}),
		});

		expect(position.vaultShares).toHaveLength(1);
		expect(position.vaultShares[0]?.shares).toBe(100n);
		expect(position.vaultShares[0]?.valueBase).toBe(150n);
		expect(position.totalOnChain).toBe(150n);
	});

	test("parses raw bigint shares and numeric exchange rate", async () => {
		const position = await reconcilePositions({
			clients,
			walletAddress: wallet,
			vaultAddresses: [VAULT_B],
			resolveWalletTokenBalanceBase: async () => 25n,
			...makeReaders({
				[VAULT_B]: { shares: 40n, rate: 2 },
			}),
		});

		expect(position.vaultShares[0]?.valueBase).toBe(80n);
		expect(position.tokenBalance).toBe(25n);
		expect(position.totalOnChain).toBe(105n);
		expect(position.totalDeployable).toBe(105n);
	});

	test("sums multi-vault values and zero shares", async () => {
		const position = await reconcilePositions({
			clients,
			walletAddress: wallet,
			vaultAddresses: [VAULT_A, VAULT_B, VAULT_C],
			resolveWalletTokenBalanceBase: async () => 10n,
			...makeReaders({
				[VAULT_A]: { shares: { totalShares: 10n }, rate: "2" },
				[VAULT_B]: { shares: 0n, rate: "3" },
				[VAULT_C]: { shares: "5", rate: 1 },
			}),
		});

		expect(position.vaultShares).toHaveLength(3);
		expect(position.vaultShares[0]?.valueBase).toBe(20n);
		expect(position.vaultShares[1]?.valueBase).toBe(0n);
		expect(position.vaultShares[2]?.valueBase).toBe(5n);
		expect(position.totalOnChain).toBe(35n);
	});
});
