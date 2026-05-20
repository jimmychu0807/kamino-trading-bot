# Quickstart: Vault Yield Rebalancer

**Branch**: `001-vault-yield-rebalance` | **Plan**: [plan.md](./plan.md)

## Prerequisites

- Bun ≥ 1.3
- Solana mainnet RPC URL
- Funded wallet (base58 private key) with deposit asset
- Three Kamino Earn vault addresses configured

## Environment

```bash
cp .env.example .env
```

```env
SOLANA_RPC=https://your-rpc-endpoint
PRIVATE_KEY=your-base58-private-key

# Three vaults (comma-separated or VAULT_A/B/C)
VAULTS=addr1,addr2,addr3

# Safety: start in preview
PREVIEW_MODE=true

# Scheduling (hourly UTC)
CRON_EXPRESSION=0 * * * *

# Policy
RISK_PROFILE=balanced
METRICS_MAX_AGE_MS=900000
RPC_TIMEOUT_MS=15000
CYCLE_TIMEOUT_MS=180000

# Optional: extra cycles when allocation drift exceeds policy.driftBandPct (FR-013)
DRIFT_TRIGGER_ENABLED=false
DRIFT_POLL_INTERVAL_MS=300000

# SQLite path (gitignored)
DATABASE_URL=./data/bot.sqlite
```

## Install & verify

```bash
bun install
bun run compile
bun run check
bun test
```

## First preview cycle (no on-chain txs)

```bash
PREVIEW_MODE=true bun run start
```

Expected: decision log with scores, targets, planned withdraw/deposit legs, `status: preview`.

## Enable live rebalancing

**Prerequisite**: Guardrails (`shouldRebalance`, cooldown, min improvement) and cycle orchestrator (`runCycle`) MUST be implemented before live txs—see tasks Phase 4 (US4) then Phase 6 (US3). Do not set `PREVIEW_MODE=false` until preview cycles show expected skip/trade decisions.

1. Confirm preview output for several cycles.
2. Set `PREVIEW_MODE=false` explicitly (config loader defaults to `true` when unset).
3. Run daemon (cron-driven):

```bash
bun run start
```

`Bun.cron` registers `CRON_EXPRESSION`; each tick runs one cycle with overlap protection. With `DRIFT_TRIGGER_ENABLED=true`, a drift poll also invokes `runCycle` when any vault exceeds `policy.driftBandPct`, using the same mutex.

## Clear execution hold

After 3 consecutive failing cycles:

```bash
bun run src/cli.ts ack-hold
```

## Integration tests

```bash
RUN_INTEGRATION_TESTS=true bun test
```

Requires `SOLANA_RPC` and configured vault addresses (read-only paths).

## Version alignment check

After dependency changes:

```bash
bun pm ls | grep @solana/kit
```

Expect a single `@solana/kit@2.3.x` tree aligned with `@kamino-finance/klend-sdk`.

## Key references

- Spec: [spec.md](./spec.md)
- Data model: [data-model.md](./data-model.md)
- [Solana Kit](https://github.com/anza-xyz/kit)
- [klend-sdk](https://github.com/Kamino-Finance/klend-sdk)
