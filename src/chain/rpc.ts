import {
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	type Rpc,
	type SolanaRpcApi,
} from "@solana/kit";

export type AppRpc = Rpc<SolanaRpcApi>;

export type RpcClients = {
	rpc: AppRpc;
	rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
	timeoutMs: number;
};

/** HTTP(S) JSON-RPC URLs must use ws/wss for subscription clients. */
export function rpcUrlToWebSocketUrl(rpcUrl: string): string {
	const url = new URL(rpcUrl);
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	} else if (url.protocol === "http:") {
		url.protocol = "ws:";
	} else if (url.protocol !== "wss:" && url.protocol !== "ws:") {
		throw new Error(`Unsupported RPC URL scheme for subscriptions: ${url.protocol}`);
	}
	return url.toString();
}

export function createRpcClients(rpcUrl: string, timeoutMs: number): RpcClients {
	return {
		rpc: createSolanaRpc(rpcUrl),
		rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrlToWebSocketUrl(rpcUrl)),
		timeoutMs,
	};
}

/**
 * Wraps an async RPC call with a per-call timeout (FR-012 default 15s).
 */
export async function withRpcTimeout<T>(
	clients: RpcClients,
	fn: (rpc: AppRpc) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), clients.timeoutMs);
	try {
		return await fn(clients.rpc);
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(`RPC call timed out after ${clients.timeoutMs}ms`, {
				cause: error,
			});
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
