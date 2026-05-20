import { setDefaultTimeout } from "bun:test";

/** RPC-backed integration tests need more than Bun's default 5s. */
setDefaultTimeout(10_000);
