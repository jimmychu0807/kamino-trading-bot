# Research: Kamino Vault Yield Rebalancer

**Branch**: `001-vault-yield-rebalance` | **Date**: 2026-05-20

## R1: Solana client stack — @solana/kit vs legacy web3.js

**Decision**: Use `@solana/kit` ^2.3.x as the sole Solana client; do not add `@solana/web3.js` 1.x.

**Rationale**:
- [anza-xyz/kit](https://github.com/anza-xyz/kit) is the maintained successor to web3.js 2.x (published as `@solana/kit`).
- Project and constitution already standardize on Kit (`createSolanaRpc`, `address`, signers).
- Tree-shakable, functional API; native `bigint` and Web Crypto keys align with Bun.

**Alternatives considered**:
- **@solana/web3.js 1.x**: Rejected — klend-sdk 7.x does not depend on it; mixing 1.x and Kit causes dual-package types and conversion overhead.
- **Anchor-only client**: Rejected — Earn vault flows are exposed via `KaminoVault` in klend-sdk, not raw Anchor in app code.

---

## R2: klend-sdk version alignment with Kit

**Decision**: Pin `@kamino-finance/klend-sdk@^7.3.22` and `@solana/kit@^2.3.0` together; add `package.json` `overrides` so nested Kamino packages resolve a single `@solana/kit` minor (2.3.x).

**Rationale**:
- Installed `klend-sdk@7.3.22` declares `@solana/kit: ^2.3.0`, `@solana/compat: ^2.3.0`, and `@solana-program/*` 0.5–0.8 — same major/minor family as app dependency `@solana/kit@2.3.0`.
- klend-sdk already ships Kit-native vault APIs: `KaminoVault` with `depositIxs`, `withdrawIxs`, `getUserShares`, `getAPYs`, `getVaultHoldings`, `getVaultAllocations`.
- Existing `src/vault.ts` proves the integration path works with `createSolanaRpc` + `address()`.

**Version consistency rules** (enforce in CI / `bun pm ls`):
1. Never bump `@solana/kit` to 3.x until klend-sdk release notes confirm support.
2. After any klend-sdk upgrade, run `bun run compile` and integration tests; check for duplicate `@solana/kit` versions in the lockfile.
3. Use `overrides` for `@kamino-finance/farms-sdk` (already present) and add `"@solana/kit": "2.3.0"` if Bun resolves multiple minors.
4. Pass **one** `Rpc` instance from `createSolanaRpc(url)` into all `KaminoVault` instances — do not construct parallel Connection-style clients.

**Alternatives considered**:
- **Kamino REST/KTX only**: Rejected for execution — spec requires on-chain reconciliation; KTX useful later for unsigned-tx preview but SDK `*Ixs` + Kit send path is sufficient for v1.
- **Fork klend-sdk**: Rejected — maintenance burden; compat layer `@solana/compat` is for legacy interop inside SDK, not app code.

---

## R3: Schema validation — Zod

**Decision**: Zod for all operator config, policy presets, env parsing, and boundary types (addresses, percentages, durations).

**Rationale**:
- User requirement; fits Bun/TS without codegen.
- Parse once at startup (`config/schema.ts`); export inferred types for strategy modules.
- Custom refinements: base58 address, positive bps, cron expression, vault triplet uniqueness.

**Alternatives considered**:
- **Valibot**: Smaller bundle but team/constitution already implied Zod via user input.
- **JSON Schema only**: Rejected — no runtime validation in process without extra lib.

---

## R4: Persistence — Drizzle + SQLite

**Decision**: Drizzle ORM with `bun:sqlite` (local file `data/bot.sqlite`, gitignored).

**Rationale**:
- FR-010, FR-015, FR-016 require durable decision logs, hold state, metrics history, and backtest inputs.
- SQLite matches single-operator, single-process bot; no external DB ops.
- Drizzle has first-class Bun SQLite driver support and migration-friendly schema.

**Alternatives considered**:
- **Append-only JSONL**: Rejected for v1 — harder to query hold state and backtest windows.
- **Postgres**: Rejected — overkill for v1 scope.

---

## R5: Scheduling — Bun.cron

**Decision**: `Bun.cron` for primary periodic wake (default hourly); optional second cron for drift checks if `DRIFT_CHECK_CRON` set; in-process mutex prevents overlapping cycles.

**Rationale**:
- User requirement; no separate scheduler process.
- Spec FR-013: periodic + optional threshold-triggered evaluation — drift band checked at end of each cron tick (and can share hourly tick).

**Alternatives considered**:
- **setInterval**: Rejected — no standard cron semantics for operators.
- **OS cron + one-shot CLI**: Rejected — extra deploy complexity for v1.

---

## R6: Transaction execution pattern

**Decision**: Withdraw-then-deposit batch per FR-007 using `vault.withdrawIxs(signer, shares)` then `vault.depositIxs(signer, amount)`; compile/sign/send via Kit (`sendAndConfirmTransaction` or pipeline with blockhash + signers).

**Rationale**:
- Wallet-as-hub matches spec clarifications and Kamino Earn tutorials.
- klend-sdk returns instruction arrays compatible with Kit transaction message builders.
- Per-leg retry (3× exponential backoff) and 15s RPC timeout wrap the send layer, not the strategy layer.

**Alternatives considered**:
- **Atomic multi-vault single tx**: Rejected — size/complexity and partial-failure handling favor phased batch + reconcile.

---

## R7: Metrics ingestion

**Decision**: Hybrid — klend-sdk on-chain reads for positions/APY/TVL/allocations; Kamino public API (`GET /kvaults/vaults/{pubkey}/metrics`) for historical/backtest with shared Zod snapshot schema.

**Rationale**:
- Spec FR-002/FR-012: freshness and timeout apply to all sources.
- On-chain is source of truth for execution; API supplements history and volatility signals.

**Alternatives considered**:
- **API-only**: Rejected — reconciliation requires chain state.
- **Chain-only**: Rejected — backtest (FR-016) needs efficient history.

---

## R8: Three vault configuration

**Decision**: Env + Zod config: `VAULT_A_ADDRESS`, `VAULT_B_ADDRESS`, `VAULT_C_ADDRESS` (or `VAULTS=addr1,addr2,addr3`); extend `constants.ts` defaults only as examples.

**Rationale**:
- FR-001: exactly three vaults per instance.
- Spec assumption: operator supplies IDs; no auto-discovery in v1.

---

## R9: Preview mode and holds

**Decision**: `PREVIEW_MODE=true` skips `send*`; dependency vs execution hold persisted in SQLite with distinct resume rules per FR-019.

**Rationale**: Direct mapping to user stories 3 and 5; operator acknowledgment flag file or DB column `execution_hold_ack_at`.

---

## Open items resolved

| Unknown | Resolution |
|---------|------------|
| Earn vs Lend product | K-Vault / `KaminoVault` in klend-sdk (Earn), not `KaminoMarket` lending obligations |
| Kit ↔ klend version lock | Align on 2.3.x; overrides + upgrade checklist |
| Scheduler | Bun.cron + overlap guard |
| Storage | Drizzle + sqlite |

No remaining **NEEDS CLARIFICATION** items for Phase 1.
