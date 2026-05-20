export type AppConfig = {
	solanaRpc: string;
	privateKey: string;
	prodAddress: string;
};

const DEFAULT_PROD_ADDRESS = "6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ";

export function loadConfig(
	env: Record<string, string | undefined> = process.env,
): AppConfig {
	const solanaRpc = env.SOLANA_RPC ?? "";
	const privateKey = env.PRIVATE_KEY ?? "";

	if (!solanaRpc) {
		throw new Error("SOLANA_RPC not defined");
	}
	if (!privateKey) {
		throw new Error("PRIVATE_KEY not defined");
	}

	return {
		solanaRpc,
		privateKey,
		prodAddress: env.PROD_ADDR ?? DEFAULT_PROD_ADDRESS,
	};
}

export function loadRpcUrl(
	env: Record<string, string | undefined> = process.env,
): string {
	const solanaRpc = env.SOLANA_RPC ?? "";
	if (!solanaRpc) {
		throw new Error("SOLANA_RPC not defined");
	}
	return solanaRpc;
}
