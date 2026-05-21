import { describe, expect, test } from "bun:test";
import type { Signature } from "@solana/kit";
import { buildAndSendInstructions } from "../../src/chain/tx.ts";

describe("buildAndSendInstructions retry", () => {
	test("retries after failure and returns attempts count", async () => {
		let calls = 0;
		const result = await buildAndSendInstructions(
			{ rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
			{ address: "wallet" } as never,
			[],
			{
				maxAttempts: 3,
				initialBackoffMs: 1,
				sendOnce: async () => {
					calls += 1;
					if (calls < 2) {
						throw new Error("simulated send failure");
					}
					return "sig-retry-ok" as Signature;
				},
			},
		);

		expect(result.attempts).toBe(2);
		expect(result.signature).toBe("sig-retry-ok");
		expect(calls).toBe(2);
	});

	test("throws after maxAttempts exhausted", async () => {
		await expect(
			buildAndSendInstructions(
				{ rpc: {} as never, rpcSubscriptions: {} as never, timeoutMs: 15_000 },
				{ address: "wallet" } as never,
				[],
				{
					maxAttempts: 2,
					initialBackoffMs: 1,
					sendOnce: async () => {
						throw new Error("always fails");
					},
				},
			),
		).rejects.toThrow("Transaction leg failed after 2 attempts");
	});
});
