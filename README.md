# Kamino Multi-Vault Yield Rebalance Bot

A Bun/TypeScript CLI bot that reallocates deposits across 1–3 [Kamino Earn (K-Vault)](https://kamino.com/docs) vaults using a proportional-by-APY strategy. It reads configuration from `.env`, runs for a configurable duration, and rebalances on a fixed interval while capping each cycle's moves with `MAX_ALLOCATION`.

> [!WARNING]
> This bot moves real funds on Solana mainnet when `DRY_RUN=false`. Start with `DRY_RUN=true`, verify planned actions in logs, and only use a funded wallet you control.

## Features

- **Proportional-by-APY allocator** — target weights follow each vault's APY; swappable via `planRebalance(input, strategy)`.
- **Kamino API yield source** — fetches live APY from `GET /kvaults/vaults/{addr}/metrics`.
- **On-chain execution** — deposit/withdraw via `@kamino-finance/klend-sdk` and `@solana/kit`.
- **Dry-run mode** — plans and logs actions without sending transactions (default).
- **Test suites** — unit, integration (RPC-gated), and e2e dry-run tests.

## Quick start

```bash
bun install
cp .env.example .env
# Edit .env with your RPC URL, private key, and vault addresses
bun run start -- --duration 300 --interval 60
```

> [!NOTE]
> `bun install` runs a postinstall patch for a missing `@kamino-finance/farms-sdk` export required by `klend-sdk`.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `SOLANA_RPC` | yes | HTTP RPC URL |
| `PRIVATE_KEY` | yes | Base58 secret or JSON byte array (solana-keygen format) |
| `VAULT_ADDRESSES` | yes | Comma-separated **1–3** vault pubkeys (same underlying mint) |
| `MAX_ALLOCATION` | yes | Max token units to move per cycle (e.g. `100` USDC) |
| `RUN_SECONDS` | no | Total runtime; omit to run indefinitely |
| `REBALANCE_INTERVAL_SECONDS` | no | Cycle period (default: `900` = 15 min) |
| `DRY_RUN` | no | `true` = plan only (default: `true`) |
| `MIN_MOVE_AMOUNT` | no | Skip moves below dust threshold |

CLI flags override env:

```bash
bun run src/cli.ts --duration 300 --interval 60
```

Validation fails fast if vault count is outside 1–3 or `duration <= interval`.

## Strategy

Each rebalance cycle:

1. Fetch APY per vault from the Kamino API.
2. Read user position value (`shares × exchange rate`) via the SDK.
3. Compute target weights: `weight_i = apy_i / sum(apy)` (equal weights if all APY is zero).
4. Compute deltas vs target allocation.
5. Scale total move size to `MAX_ALLOCATION` (pro-rata if needed).
6. Execute withdraws first, then deposits (same underlying token).

Swap strategies by passing a different `AllocationStrategy` to `planRebalance`.

## Tests

```bash
bun test                  # all tests
bun run test:unit         # config, strategy, runner (no network)
bun run test:integration  # Kamino API + RPC vault reads
bun run test:e2e          # in-process dry-run bot
```

Integration vault tests skip automatically when `SOLANA_RPC` is unset. Optional live e2e requires `E2E_LIVE=true`.

## Project layout

```
src/
  config/       env parsing and types
  solana/       RPC + signer setup
  kamino/       yield source, vault client, tx executor
  strategy/     planRebalance + proportionalByApy
  bot/          runner and rebalance cycle
  cli.ts        entry point
tests/
  unit/
  integration/
  e2e/
```

## Safety

- Keep `DRY_RUN=true` until you trust the planned actions.
- All configured vaults must share the same underlying token mint.
- v1 sends one transaction per action (withdraw or deposit) for simpler debugging.
- Farm staking is not enabled in v1 (`farmState: null`).
