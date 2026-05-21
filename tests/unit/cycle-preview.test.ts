import { describe, expect, test } from "bun:test";
import { loadDecisionLog, runCycle } from "../../src/cycle/runner.ts";
import { basePreviewConfig, buildCycleContext } from "../helpers/cycle-fixtures.ts";
import { createTestDb } from "../helpers/test-db.ts";
import { makeWalletPosition } from "../helpers/wallet-position.ts";

describe("runCycle preview path", () => {
	test("plans legs and persists decision log without executing txs", async () => {
		const db = createTestDb();
		let executeCalled = false;

		const result = await runCycle(
			buildCycleContext(db, {
				executeActions: async () => {
					executeCalled = true;
					return { status: "completed", actions: [] };
				},
			}),
		);

		expect(executeCalled).toBe(false);
		expect(result.status).toBe("preview");
		expect(result.actions.length).toBeGreaterThan(0);

		const persisted = await loadDecisionLog(db, result.cycleId);
		expect(persisted).not.toBeNull();
		expect(persisted?.outcome).toBe("preview");
		expect(persisted?.rationale).toContain("Preview mode");
		expect(persisted?.scores).toBeInstanceOf(Array);
		expect((persisted?.scores as unknown[]).length).toBe(3);
	});

	test("applies MAX_ALLOCATION cap to decision log position", async () => {
		const db = createTestDb();
		const uncapped = makeWalletPosition({
			tokenBalance: 50n,
			vaultShares: [
				{
					vaultAddress: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
					shares: 1n,
					valueBase: 90n,
				},
			],
		});

		const result = await runCycle(
			buildCycleContext(db, {
				config: { ...basePreviewConfig, maxAllocationBase: 100n },
				reconcile: async () => uncapped,
			}),
		);

		const persisted = await loadDecisionLog(db, result.cycleId);
		const logged = persisted?.inputs as {
			position?: {
				totalOnChain?: string;
				totalDeployable?: string;
				walletBalanceCounted?: string;
			};
		};
		expect(logged.position?.totalOnChain).toBe("140");
		expect(logged.position?.totalDeployable).toBe("100");
		expect(logged.position?.walletBalanceCounted).toBe("10");
	});
});
