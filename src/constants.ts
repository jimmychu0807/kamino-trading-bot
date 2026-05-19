/** Kamino vault addresses used by the bot (Solana mainnet). */
export const VAULT_ADDRESSES = {
	usdc: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	steakhouseUsdc: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	allezUsds: "A1USdsC4kypCgPw5dHAwmqDjfFKrtdVHtXLhDY9QvHQ3",
} as const;

export const DEFAULT_PROD_USER = "6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ";

/** Base58 Solana address: 32–44 characters, no 0/O/I/l. */
export function isBase58Address(value: string): boolean {
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
