# Kamino Trading Bot

Assignment ask:
- Write a Typescript bot that reallocates between 3 Kamino lending vaults to maximize yield. Open ended. Decide what extra features you would implement and why.
- Document your project for other developers to build upon.

TypeScript bot for reading Kamino vault state on Solana mainnet. Uses Bun, `@kamino-finance/klend-sdk`, and `@solana/kit`.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.3
- Solana RPC URL (Helius, QuickNode, or similar)
- Wallet private key (base58) for signing when required

## Setup

```bash
bun install
```

Copy environment variables (create `.env` in the project root; never commit it):

```bash
SOLANA_RPC=https://your-rpc-endpoint
PRIVATE_KEY=your-base58-private-key
# Optional: override default prod user address
# PROD_ADDR=6zkpieP6nfE9AjLyqBSfnsaQYg3ruEuKCRRdSxhz48vJ
```

## Run

```bash
bun run start
```

Fetches holdings, APYs, exchange rate, allocations, and user share value for the Allez USDS vault.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run start` | Run the bot (`src/index.ts`) |
| `bun test` | Unit tests (integration tests skipped by default) |
| `bun run test:integration` | Unit + integration tests (requires RPC) |
| `bun run compile` | Typecheck with `tsc --noEmit` |
| `bun run check` | Lint/format check (Biome) |
| `bun run format` | Auto-fix with Biome |

## Testing

Tests live under `tests/unit/` and `tests/integration/` per the [project constitution](.specify/memory/constitution.md).

**Unit tests** (no network):

```bash
bun test
```

**Integration tests** (live RPC; read-only):

```bash
RUN_INTEGRATION_TESTS=true bun test
```

Requires `SOLANA_RPC` in `.env` or the environment. Integration tests call Kamino mainnet vaults and may be slow or rate-limited.

## Project layout

```text
src/
├── index.ts      # Entry point
├── config.ts     # Environment loading and validation
├── constants.ts  # Vault addresses and helpers
└── vault.ts      # Kamino vault read adapters

tests/
├── unit/         # Fast tests, no RPC
└── integration/  # RPC-gated Kamino contract tests

.specify/         # Spec Kit templates and constitution
```

## Spec Kit

Feature work uses Spec Kit commands (`/speckit-specify`, `/speckit-plan`, etc.). Governance rules are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Security

- Do not commit `.env` or private keys.
- Integration and local runs use real mainnet RPC; treat outputs as sensitive if they include wallet-linked data.
