# Kamino Vault Yield Rebalancer

Automated TypeScript bot that reallocates capital across three [Kamino Earn](https://kamino.finance) vaults using risk-adjusted scoring, guardrails, preview mode, and operational holds. Built with [Bun](https://bun.com), [`@kamino-finance/klend-sdk`](https://github.com/Kamino-Finance/klend-sdk), and [`@solana/kit`](https://github.com/anza-xyz/kit).

## Features

- Scores three vaults on risk-adjusted yield and computes target allocations.
- Rebalances via withdraw-then-deposit batches through a single operator wallet.
- Defaults to **preview mode** (no on-chain transactions) until you explicitly enable live execution.
- Persists every cycle decision, metrics snapshot, and hold state in SQLite.
- Schedules evaluation on `Bun.cron` with optional drift-triggered extra cycles.
- Pauses after repeated transaction failures until an operator acknowledges the hold.
- Config three different `RISK_PROFILE` preset: **conservative**, **balanced**, and **aggresive**. [See below](#risk_profile--how-it-changes-allocation).
- Supports strategy backtesting. [See below](#backtesting).

> [!IMPORTANT]
> This bot sends real mainnet transactions when `PREVIEW_MODE=false`. Run several preview cycles and validate decisions before going live.

## Architecture

```mermaid
flowchart TB
  subgraph entry["Entry points"]
    index["src/index.ts<br/>daemon"]
    cli["src/cli.ts<br/>cycle · ack-hold · backtest"]
  end

  subgraph config["Configuration"]
    dotenv[".env"]
    load["config/load.ts"]
    schema["config/schema.ts<br/>Zod"]
  end

  subgraph schedule["Scheduling & concurrency"]
    cron["schedule-cron.ts<br/>Bun.cron"]
    drift["drift-trigger.ts<br/>optional poll"]
    mutex["mutex.ts<br/>single cycle in flight"]
  end

  subgraph orchestration["Cycle orchestration"]
    runner["cycle/runner.ts<br/>runCycle"]
    execute["cycle/execute.ts<br/>withdraw → deposit"]
    hold["cycle/hold.ts<br/>dependency / execution holds"]
    backtest["cycle/backtest.ts"]
  end

  subgraph strategy["Strategy"]
    metricsUse["metrics snapshots"]
    risk["strategy/risk.ts"]
    alloc["strategy/allocate.ts"]
    warrant["strategy/warrant.ts"]
    cap["strategy/deployable.ts<br/>MAX_ALLOCATION"]
  end

  subgraph kamino["Kamino layer"]
    vault["kamino/vault.ts<br/>KaminoVault"]
    reconcile["kamino/reconcile.ts"]
    metrics["kamino/metrics.ts"]
  end

  subgraph chain["Solana chain"]
    rpc["chain/rpc.ts"]
    signer["chain/signer.ts"]
    tx["chain/tx.ts"]
  end

  subgraph persist["Persistence & alerts"]
    db["db/*<br/>Drizzle + SQLite"]
    alerts["alerts/emit.ts"]
  end

  solana[("Solana mainnet RPC")]
  vaults[("3 Kamino Earn vaults")]
  kaminoApi[("Kamino public API<br/>backtest only")]
  webhook[("Alert webhook<br/>optional")]

  index --> load
  cli --> load
  dotenv --> load
  load --> schema

  index --> cron
  index --> drift
  cron --> mutex
  drift --> mutex
  mutex --> runner
  cli --> runner
  cli --> backtest

  runner --> metrics
  runner --> reconcile
  runner --> risk
  runner --> alloc
  runner --> warrant
  runner --> cap
  runner --> execute
  runner --> hold
  runner --> db
  runner --> alerts

  metrics --> vault
  reconcile --> vault
  execute --> tx
  vault --> rpc
  tx --> rpc
  tx --> signer
  rpc --> solana
  vault --> vaults
  backtest -.-> kaminoApi
  alerts -.-> webhook
```



**Cycle flow (one tick):** load config → check holds → fetch metrics → reconcile wallet/vault positions → score and target allocations → warrant (skip if churn not worth it) → plan legs → execute or preview → log to SQLite and optional webhook.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.3
- Solana mainnet RPC URL
- Wallet private key (base58) funded with the vault deposit asset
- Three Kamino Earn vault addresses

## Environment

Copy and edit `.env` from `.env.example` (never commit `.env`):

```bash
cp .env.example .env
```

Config the following env:
- `PRIVATE_KEY` - your Solana wallet where capital is deployed from.
- `SOLANA_RPC` - Performant RPC endpoint that support calling Solana API `GetProgramAccounts()`.

Key variables:


| Variable                              | Description                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOLANA_RPC`                          | Mainnet RPC endpoint. Use paid Alchemy or Helius RPC that support calling `[GetProgramAccounts()](https://solana.com/docs/rpc/http/getprogramaccounts)`                                              |
| `PRIVATE_KEY`                         | Base58 signing key from which the fund will disperse from                                                                                                                                            |
| `VAULTS`                              | Three comma-separated vault addresses                                                                                                                                                                |
| `MAX_ALLOCATION`                      | Optional cap on **counted wallet input** (token base units, e.g. `10000000` = 10 USDC with 6 decimals). Vault principal is always fully counted; yield above the cap is not clipped. Unset = no cap. |
| `PREVIEW_MODE`                        | `true` (default) = no on-chain txs; set `false` explicitly for live                                                                                                                                  |
| `CRON_EXPRESSION`                     | `Bun.cron` schedule (default to run every 15 mins)                                                                                                                                                   |
| `DRIFT_TRIGGER_ENABLED`               | Optional extra cycles when drift exceeds `driftBandPct`                                                                                                                                              |
| `RISK_PROFILE`                        | `conservative` | `balanced` | `aggressive`                                                                                                                                                           |
| `METRICS_MAX_AGE_MS`                  | Stale metrics cutoff (default 15 min)                                                                                                                                                                |
| `APY_SPIKE_GUARD_MULTIPLE`            | Skip trading when APY > N× trailing average (default 3)                                                                                                                                              |
| `RPC_TIMEOUT_MS` / `CYCLE_TIMEOUT_MS` | Per-call and per-cycle limits                                                                                                                                                                        |
| `DATABASE_URL`                        | SQLite path (default `./data/bot.sqlite`)                                                                                                                                                            |
| `ALERT_WEBHOOK_URL`                   | Optional JSON alert webhook                                                                                                                                                                          |


See [specs/001-vault-yield-rebalance/quickstart.md](specs/001-vault-yield-rebalance/quickstart.md) for the full operator flow.

## Install & database

```bash
bun install
bun run db:migrate
```

## Scripts


| Command                    | Description                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun run start`            | Cron daemon + optional drift trigger (`src/index.ts`)                                          |
| `bun run cli cycle`        | One rebalance cycle (preview or live per `PREVIEW_MODE`); optional `--max-allocation` override |
| `bun run cli ack-hold`     | Acknowledge execution hold after repeated tx failures                                          |
| `bun run cli backtest`     | Historical policy replay (no on-chain txs)                                                     |
| `bun run db:migrate`       | Apply SQLite migrations                                                                        |
| `bun run db:generate`      | Generate Drizzle migrations                                                                    |
| `bun test`                 | Unit tests                                                                                     |
| `bun run test:integration` | Integration tests (requires RPC + vaults)                                                      |
| `bun run test:e2e`         | Full process smoke test (~15s, gated)                                                          |
| `bun run test:e2e:slow`         | Full process smoke test (~30s, gated)                                                          |
| `bun run compile`          | Typecheck (`tsc --noEmit`)                                                                     |
| `bun run check`            | Biome lint/format check                                                                        |
| `bun run format`           | Biome auto-fix                                                                                 |


## First preview cycle

```bash
PREVIEW_MODE=true bun run cli cycle
```

Override the deployable cap for a single run (token base units; overrides `MAX_ALLOCATION` from `.env`):

```bash
PREVIEW_MODE=true bun run src/cli.ts cycle --max-allocation=10000000
```

Expected: decision log with scores, targets, and planned legs; `status: preview` or `skipped` — no deposits or withdrawals. When capped, `inputs.position` includes `totalOnChain` (raw) and `totalDeployable` (effective).

### MAX_ALLOCATION behavior

- Caps how much **idle wallet balance** is counted toward allocation, not vault value after deployment.
- Example with `MAX_ALLOCATION=100000000` (100 USDC): $90 in vaults + $10 reserve → deployable **100M** base units; after yield grows to $120 in vaults + $10 reserve → deployable **130M** (vault growth is never clipped).

## Backtesting

Replay the same allocation and rebalance-warrant logic as live cycles over historical vault metrics — **no on-chain transactions**, no wallet sends. Use this to compare your configured `RISK_PROFILE` against a fixed equal-weight baseline before enabling live trading.

### How it works

```mermaid
flowchart LR
  api["Kamino public API<br/>metrics/history"]
  sqlite[("SQLite<br/>metric_snapshots")]
  import["--import"]
  load["loadMetricSnapshots"]
  align["groupSnapshotsByTimestamp<br/>all 3 vaults per instant"]
  sim["simulateBacktestSteps<br/>chronological replay"]
  report["JSON BacktestReport"]

  api --> import --> sqlite
  sqlite --> load --> align --> sim --> report
```

1. **Fetch (optional)** — With `--import`, the bot calls `GET https://api.kamino.finance/kvaults/vaults/{vault}/metrics/history` for each address in `VAULTS`, optionally filtered by `--start` / `--end` (ISO-8601). Responses are parsed into `VaultMetricsSnapshot` rows (APY, TVL, reserve weights, trailing yield volatility).
2. **Persist** — Imported points are appended to the `metric_snapshots` table in `DATABASE_URL` (same SQLite DB as live cycles; run `bun run db:migrate` first).
3. **Load & align** — Snapshots are read from SQLite, filtered by vault list and date window, then grouped by `capturedAt`. Only timestamps where **all three** configured vaults have a row are kept (partial instants are skipped).
4. **Replay consecutively** — For each aligned timestep in order, the bot runs `computeTargetsFromSnapshots` → `shouldRebalance` (drift, cooldown, min improvement, critical-risk rules) → updates simulated allocations when warranted → accrues period risk-adjusted return. The last timestep uses a 24h synthetic interval when there is no next point.
5. **Report** — Prints JSON comparing **strategy** cumulative risk-adjusted return vs an **equal-weight** baseline that never rebalances.

Live preview cycles do not populate `metric_snapshots` today; backtest history comes from `--import` or manual inserts.

### Prerequisites

- `.env` with `VAULTS` (three comma-separated addresses) and `DATABASE_URL` (default `./data/bot.sqlite`)
- `bun run db:migrate` applied
- Network access when using `--import` (Kamino public API only; no Solana RPC required for import/replay)

`PRIVATE_KEY` is still loaded from env by the CLI but is not used during backtest.

### One-shot: import and replay

Fetch history, write to SQLite, then run the simulation in a single command:

```bash
bun run cli backtest --import
```

Limit the API window (recommended for faster runs):

```bash
bun run cli backtest --import --start=2025-01-01T00:00:00.000Z --end=2025-06-01T00:00:00.000Z
```

### Two-step: import once, replay many times

**1. Import historical metrics into SQLite**

```bash
bun run cli backtest --import --start=2025-01-01T00:00:00.000Z --end=2025-06-01T00:00:00.000Z
```

**2. Replay from stored rows** (no API calls; uses whatever is already in `metric_snapshots`)

```bash
bun run cli backtest
```

Same date filters apply to the DB query:

```bash
bun run cli backtest --start=2025-03-01T00:00:00.000Z --end=2025-05-01T00:00:00.000Z
```

Re-run step 2 after changing `RISK_PROFILE` or other policy env vars to compare presets against the same imported history. Re-importing the same window appends rows (duplicates at the same instant are collapsed per vault when grouping).

### Example output

```json
{
  "start": "2025-01-15T00:00:00.000Z",
  "end": "2025-05-30T00:00:00.000Z",
  "steps": 42,
  "rebalanceCount": 7,
  "strategyCumulativeRiskAdjustedReturn": 0.0412,
  "equalWeightCumulativeRiskAdjustedReturn": 0.0381,
  "relativeImprovementPct": 8.14,
  "summary": "steps=42; rebalances=7; strategy_risk_adj_return=0.041200; ...",
  "stepsDetail": [
    {
      "timestamp": "2025-01-15T00:00:00.000Z",
      "strategyReturn": 0.00098,
      "baselineReturn": 0.00095,
      "rebalanced": false,
      "reason": "drift within band"
    }
  ]
}
```

| Field | Meaning |
| ----- | ------- |
| `steps` | Aligned timesteps replayed (all three vaults present) |
| `rebalanceCount` | Simulated rebalances that passed warrant checks |
| `strategyCumulativeRiskAdjustedReturn` | Your policy with dynamic targets |
| `equalWeightCumulativeRiskAdjustedReturn` | Fixed ⅓ deployable split, never trades |
| `relativeImprovementPct` | Strategy vs baseline (see `summary` for one-line stats) |
| `stepsDetail` | Per-timestep returns and warrant `reason` |

### CLI flags

| Flag | Description |
| ---- | ----------- |
| `--import` | Fetch Kamino metrics history for all `VAULTS` and persist to SQLite before replay |
| `--start=<ISO-8601>` | Lower bound for API fetch and/or DB load |
| `--end=<ISO-8601>` | Upper bound for API fetch and/or DB load |

Equivalent: `bun run src/cli.ts backtest [--start=ISO] [--end=ISO] [--import]`.

Implementation: `src/cycle/backtest.ts`, `src/kamino/metrics-history.ts`, `src/db/metrics.ts`.

## Live rebalancing

1. Run several preview cycles and confirm skip/trade decisions look correct.
2. Set `PREVIEW_MODE=false` explicitly (loader defaults to `true` when unset).
3. Start the daemon:

```bash
bun run start
```
`Bun.cron` runs one cycle per tick with overlap protection. With `DRIFT_TRIGGER_ENABLED=true`, a drift poll can trigger additional cycles when allocation drift exceeds `policy.driftBandPct`.

### `RISK_PROFILE` — how it changes allocation

Preset values (the behavioral knobs):

| Field | conservative | balanced | aggressive |
|-------|-------------|----------|------------|
| `maxSingleVaultPct` | 40% | 50% | 60% |
| `cashBufferPct` | 5% | 3% | 0% |
| `criticalRiskFloor` | 0.25 | 0.20 | 0.15 |
| `minImprovementBps` | 35 | 25 | 15 |
| `cooldownMs` | 6h | 6h | 4h |
| `driftBandPct` | 2% | 2% | 3% |
| `riskWeights` | more liquidity | balanced | more volatility |

Where it affects the runtime behavior:

**Target allocation (`src/strategy/allocate.ts` + `risk.ts`):**

- **`riskWeights`** → composite safety score per vault (`computeRiskScore` in `risk.ts`).
- **`criticalRiskFloor`** → vault marked `critical` when composite &lt; floor; critical vaults get **zero** attractiveness weight (no new allocation toward them).
- **`cashBufferPct`** → `deployablePct = 100 - cashBufferPct` (conservative keeps more unallocated).
- **`maxSingleVaultPct`** → per-vault cap in `distributeWithCaps` / `applyPolicyCaps`.

**Whether to trade (`src/strategy/warrant.ts`):**

- **`driftBandPct`** — skip if current vs target drift ≤ band.
- **`cooldownMs`** — skip if last rebalance was too recent.
- **`minImprovementBps`** — skip if expected yield improvement is too small.
- Critical-risk exit logic uses scores from the same profile-driven risk floor.

**Drift trigger (`src/cycle/drift-trigger.ts`):** uses `policy.driftBandPct` (2% vs 3% for aggressive) to decide extra cycles.

**Net effect:** conservative = lower caps, more cash buffer, stricter risk floor (fewer “safe” vaults), higher bar to rebalance; aggressive = opposite.

`RISK_PROFILE` does **not** change which vaults you configure in `VAULTS` — only policy/scoring/allocation/trade gating.

## Clear execution hold

After three consecutive cycles with failed transactions:

```bash
bun run cli ack-hold
```

> [!TIP]
> Dependency holds (stale metrics, RPC timeouts) clear automatically when checks pass. Execution holds after repeated tx failures require `ack-hold`.

## Testing

```bash
# Check syntax and formatting
bun run check
# Typecheck
bun run compile
# Unit test
bun test
# Integration test
bun test:integration
# End-to-end test, take ~15s
bun test:e2e
```

Integration and e2e tests require `RUN_INTEGRATION_TESTS=true` / `RUN_E2E_TESTS=true` and a configured RPC (see `.env.example`).

## Dependency versions

Solana stack is pinned to a single Kit tree:

```bash
bun pm ls | grep @solana/kit
```

Expect `@solana/kit@2.3.x` aligned with `@kamino-finance/klend-sdk` (see `package.json` overrides). Do not add `@solana/web3.js` 1.x.

## Project layout

```text
src/
├── index.ts           # Daemon entry (cron + drift trigger)
├── cli.ts             # cycle | ack-hold | backtest | daemon
├── config/
│   ├── schema.ts      # Zod operator config
│   └── load.ts        # Env → config
├── chain/             # RPC, signer, tx send/confirm
├── kamino/            # Vault reads, metrics, reconcile
├── strategy/          # Risk, allocation, warrant, deployable cap
├── cycle/             # runCycle, execute, holds, backtest
├── db/                # Drizzle SQLite
└── alerts/            # Structured alerts + webhook

tests/
├── unit/
├── integration/
└── e2e/

specs/001-vault-yield-rebalance/   # Feature spec, plan, quickstart
```

## Spec Kit

Feature design lives under `specs/001-vault-yield-rebalance/`. Governance: `[.specify/memory/constitution.md](.specify/memory/constitution.md)`.

## Security

- Do not commit `.env`, private keys, or `data/bot.sqlite`.
- Default to preview mode; enable live only after validating decisions.
- Integration and daemon runs use real mainnet RPC.

