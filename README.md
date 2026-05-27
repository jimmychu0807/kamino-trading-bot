# Kamino Multi-Vault Yield Rebalance Bot

A Bun/TypeScript CLI bot that reallocates deposits across 1–3 [Kamino Earn (K-Vault)](https://kamino.com/docs) vaults using a proportional-by-APY strategy. It reads configuration from `.env`, runs for a configurable duration, and rebalances on a fixed interval while capping each cycle's moves with `MAX_ALLOCATION`.

> [!WARNING]
> This bot moves real funds on Solana mainnet when `DRY_RUN=false`. Start with `DRY_RUN=true`, verify planned actions in logs, and only use a funded wallet you control.

## Features

- **Proportional-by-APY allocator** — target weights follow each vault's APY; swappable via `planRebalance(input, strategy)`.
- **Kamino API yield source** — fetches live APY from `GET /kvaults/vaults/{addr}/metrics`.
- **On-chain execution** — deposit/withdraw via `@kamino-finance/klend-sdk` and `@solana/kit`.
- **Dry-run mode** — plans and logs actions without sending transactions (default).
- **Wallet balance awareness** — logs SOL/USDC at startup; keeps wallet USDC as reserve during rebalancing.
- **Test suites** — unit, integration (RPC-gated), and e2e dry-run tests.

## Quick start

```bash
bun install
cp .env.example .env
# Edit .env with your RPC URL, private key, and vault addresses
bun run start -- --duration 300 --interval 60
```

> [!NOTE]
> `@kamino-finance/farms-sdk` is pinned to `3.2.24` because `klend-sdk@8` imports `dist/@codegen/farms/programId`, which was removed in `farms-sdk@3.2.25+`.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `SOLANA_RPC` | yes | HTTP RPC URL |
| `PRIVATE_KEY` | yes | Base58 secret or JSON byte array (solana-keygen format) |
| `VAULT_ADDRESSES` | yes | Comma-separated **1–3** vault pubkeys (same underlying mint) |
| `MAX_ALLOCATION` | yes | Max reserve principal deployable into vaults (e.g. `10` USDC); yield growth does not count |
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

On startup the bot logs the signer wallet’s **SOL** balance and **USDC** (SPL) balance.

Each rebalance cycle:

1. Fetch APY per vault from the Kamino API.
2. Read user position value (`shares × exchange rate`) via the SDK.
3. Read wallet USDC (available reserve) and track how much reserve principal is already deployed.
4. On startup, vault positions count toward deployed reserve up to `MAX_ALLOCATION` (yield above that baseline does not consume budget).
5. Compute target weights: `weight_i = apy_i / sum(apy)` (equal weights if all APY is zero) using full vault totals.
6. Compute deltas vs target allocation.
7. Cap **net new deposits from reserve** to `MAX_ALLOCATION - deployed` and available wallet USDC (vault-to-vault moves are uncapped).
8. Execute withdraws first, then deposits (same underlying token).

Example: `MAX_ALLOCATION=10`, 8 USDC deployed to `vault_a`, position grows to 12 from yield — you may still deploy 2 more USDC from reserve (total position can reach 14).

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
  solana/       RPC, signer, wallet SOL/USDC balances
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
