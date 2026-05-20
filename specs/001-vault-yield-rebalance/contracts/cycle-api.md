# Contract: Rebalance Cycle (internal module API)

**Version**: 1.0.0  
**Consumers**: `src/index.ts`, CLI backtest runner, tests

## `runCycle(ctx: CycleContext): Promise<CycleResult>`

Single end-to-end rebalance evaluation (FR-006–FR-011, FR-020).

### Input: `CycleContext`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `OperatorConfig` | Zod-validated config |
| `rpc` | `Rpc<SolanaRpcApi>` | Shared Kit RPC client |
| `signer` | `TransactionSigner` | Operator key |
| `db` | `Database` | Drizzle handle |
| `now` | `Date` | Injectable clock for tests |
| `abortSignal` | `AbortSignal` | Cycle timeout (3 min default) |

### Output: `CycleResult`

| Field | Type | Description |
|-------|------|-------------|
| `cycleId` | `string` | UUID |
| `status` | `CycleStatus` | See data-model |
| `decisionLog` | `DecisionLog` | Persisted |
| `actions` | `RebalanceAction[]` | Executed or planned |
| `hold` | `HoldState \| null` | If entered this cycle |

### Ordering guarantees

1. Load active hold → exit early if execution hold without ack.
2. Reconcile `WalletPosition` on-chain.
3. Fetch metrics; fail closed if stale (dependency hold).
4. Score → target allocation → warrant check (policy).
5. If warranted and not preview: **withdraw phase** then **deposit phase**.
6. Persist decision log; update consecutive failure counter.

### Errors

| Code | Behavior |
|------|----------|
| `DEPENDENCY_HOLD` | No trades; auto-resume next cron when healthy |
| `EXECUTION_HOLD` | No trades until ack |
| `CYCLE_TIMEOUT` | Abort like partial failure (FR-020) |
| `PARTIAL_SUCCESS` | End cycle; reconcile next run |

---

## `reconcilePositions(ctx): Promise<WalletPosition>`

Read-only chain adapter; must run before planning after any prior `partial` or `timeout`.

---

## `acknowledgeExecutionHold(db): Promise<void>`

Operator CLI: `bun run src/cli.ts ack-hold` sets `hold_states.acknowledged_at`.

---

## `startDriftTrigger(ctx: CycleContext): void`

FR-013 optional scheduler. When `config.driftTriggerEnabled`:

1. On each `driftPollIntervalMs` tick, acquire `cycleInFlight` (skip if busy).
2. `reconcilePositions` → compare `computeMaxDriftPct` to `policy.driftBandPct`.
3. If exceeded, call `runCycle(ctx)` (same holds/guardrails as cron).

When disabled, no-op.

---

## `runBacktest(opts: BacktestOptions): Promise<BacktestReport>`

FR-016; no `send*` calls; reads historical snapshots from DB or API import.
