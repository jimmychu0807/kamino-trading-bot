import type { Blockhash, Slot } from "@solana/kit";

export type BlockhashWithHeight = {
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
	slot: Slot;
};
