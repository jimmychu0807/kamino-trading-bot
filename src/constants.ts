/**
 * Example Kamino Earn vault addresses (mainnet) for documentation and tests.
 * Runtime configuration MUST use `VAULTS` env — not these constants.
 */
export const EXAMPLE_VAULT_ADDRESSES = {
	steakhouseUsdc: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
	allezUsdc: "A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo",
	elementalUsdg: "DJbRxuBckoJpFVUNtWx94NghcthfGaRV5NRmEazUaddE",
} as const;

/** @deprecated Use `EXAMPLE_VAULT_ADDRESSES` */
export const VAULT_ADDRESSES = EXAMPLE_VAULT_ADDRESSES;

/** Base58 Solana address: 32–44 characters, no 0/O/I/l. */
export function isBase58Address(value: string): boolean {
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
