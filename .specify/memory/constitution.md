<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: all placeholders replaced with project-specific principles
- Added sections: Technology Stack & Constraints; Development Workflow & Quality Gates
- Removed sections: none
- Templates: plan-template.md ✅ (constitution gates); tasks-template.md ✅ (tests mandatory);
  spec-template.md ✅ (no change required); README.md ✅
- Follow-up TODOs: none
-->

# Kamino Trading Bot Constitution

## Core Principles

### I. Bun-Native Toolchain

All runtime, package management, testing, and bundling MUST use Bun (`bun install`, `bun run`,
`bun test`, `bun build`). Do not introduce npm/yarn or alternate test runners unless a documented
exception is approved in an amendment.

**Rationale**: Bun is the project standard for speed and a unified developer experience.

### II. Testable Module Boundaries

Business logic MUST live in importable modules under `src/`, not only in `src/index.ts`.
Entry points orchestrate configuration, I/O, and side effects. Pure logic and adapters MUST be
unit-testable without network access.

**Rationale**: Monolithic scripts block reliable automation and violate quality gates below.

### III. Unit & Integration Tests (NON-NEGOTIABLE)

Every change to production code in `src/` MUST include:

- **Unit tests** in `tests/unit/` for pure logic, validation, and adapters (mocked I/O).
- **Integration tests** in `tests/integration/` for Kamino/Solana read paths that touch RPC.

Integration tests MAY be gated behind `RUN_INTEGRATION_TESTS=true` and `SOLANA_RPC`, but the
suite and skip conditions MUST be documented in `README.md`. Skipped integration tests MUST NOT
be deleted to avoid CI cost; they document real external contracts.

**Rationale**: On-chain integrations fail silently without contract-level tests; unit tests catch
regressions cheaply.

### IV. Documentation Stays in Sync

`README.md` MUST reflect current setup, environment variables, scripts, test commands, and Spec Kit
workflow (`.specify/`). When behavior or tooling changes, update `README.md` in the same change
set—not as follow-up debt.

**Rationale**: Operators and agents rely on README as the source of truth for running the bot.

### V. Secrets & Safety

Private keys and RPC URLs with credentials MUST load from environment (`.env` locally, never
committed). `.env` MUST remain gitignored. Mainnet transactions require explicit human approval
outside automated test runs.

**Rationale**: Trading bots handle funds; leaked keys are irreversible losses.

## Technology Stack & Constraints

- **Language**: TypeScript (ES modules), strict typing via `bunx tsc --noEmit`.
- **Runtime**: Bun ≥ 1.3.
- **Lint/format**: Biome (`bun run check`, `bun run format`).
- **Domain**: Solana mainnet via `@solana/kit`; Kamino vaults via `@kamino-finance/klend-sdk`.
- **Spec Kit**: Feature work flows through `.specify/` templates; constitution gates apply in
  `plan.md` Constitution Check before implementation.

## Development Workflow & Quality Gates

1. **Before merge**: `bun run compile`, `bun run check`, and `bun test` MUST pass.
2. **Integration optional locally**: `RUN_INTEGRATION_TESTS=true bun test` when RPC is configured.
3. **Constitution Check**: Implementation plans MUST list any principle exceptions in Complexity
   Tracking with justification.
4. **README gate**: Features that change run or test instructions MUST update `README.md`.

## Governance

This constitution supersedes ad-hoc practices. Amendments require:

1. Updating `.specify/memory/constitution.md` with a Sync Impact Report (HTML comment).
2. Bumping `CONSTITUTION_VERSION` per semver (MAJOR: principle removal/redefinition; MINOR: new
   principle or material expansion; PATCH: clarifications only).
3. Propagating changes to affected templates and `README.md` when principles affect workflow.

All reviews MUST verify compliance with Core Principles and Quality Gates. Use `README.md` and
`.cursor/rules/bun.mdc` for day-to-day development guidance.

**Version**: 1.0.0 | **Ratified**: 2026-05-20 | **Last Amended**: 2026-05-20
