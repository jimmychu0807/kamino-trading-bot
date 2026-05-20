# Tasks: Kamino Vault Yield Rebalancer

**Input**: Design documents from `/specs/001-vault-yield-rebalance/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Constitution requires unit tests (`tests/unit/`) and integration tests (`tests/integration/`) for all `src/` production changes. Integration tests are gated on `RUN_INTEGRATION_TESTS=true`.

**Task count**: T001–T072 (72 tasks).

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US6)
- Include exact file paths in descriptions

## Path Conventions

Single-project layout per plan.md: `src/`, `tests/`, `drizzle/`, `data/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, directories, and tooling aligned with plan.md

- [ ] T001 Add `zod`, `drizzle-orm`, and `@solana/kit` override per plan.md in `package.json`
- [ ] T002 [P] Create directory scaffold: `src/config/`, `src/chain/`, `src/kamino/`, `src/strategy/`, `src/cycle/`, `src/db/`, `src/alerts/`, `drizzle/`, `data/`
- [ ] T003 [P] Add `drizzle.config.ts` and `drizzle-kit` devDependency for SQLite migrations to `data/bot.sqlite`
- [ ] T004 [P] Ensure `data/` and `data/bot.sqlite` are gitignored in `.gitignore`
- [ ] T005 [P] Extend `.env.example` with vault, policy, `PREVIEW_MODE=true` default, drift trigger, cron, timeout, and `DATABASE_URL` vars per `quickstart.md`
- [ ] T006 [P] Add npm scripts in `package.json`: `db:migrate`, `db:generate`, `cli` (`bun run src/cli.ts`)
- [ ] T007 [P] Add `tests/unit/` and `tests/integration/` placeholders aligned with plan.md test file names

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST complete before any user story

**⚠️ CRITICAL**: No user story work until this phase is complete

- [ ] T008 Implement Zod `OperatorConfig`, `VaultConfig`, `RebalancePolicy`, risk profile presets, `driftTriggerEnabled`, and `driftPollIntervalMs` in `src/config/schema.ts` (mirror `contracts/config.schema.json`; `previewMode` defaults to `true` when `PREVIEW_MODE` unset)
- [ ] T009 Implement env → config loader in `src/config/load.ts`; migrate callers off `src/config.ts`; default `previewMode` to `true` if env unset (FR-008)
- [ ] T010 [P] Unit tests for config schema refinements (exactly 3 vaults, caps, timeouts, preview default true, drift trigger fields) in `tests/unit/config.test.ts`
- [ ] T011 Define Drizzle tables (`cycles`, `metric_snapshots`, `decision_logs`, `rebalance_actions`, `hold_states`, `policy_snapshots`) in `src/db/schema.ts` per `data-model.md`
- [ ] T012 Implement SQLite client in `src/db/client.ts` using `bun:sqlite` and `DATABASE_URL`
- [ ] T013 Implement migration runner in `src/db/migrate.ts` and initial SQL under `drizzle/`
- [ ] T014 [P] Implement shared Kit RPC factory with per-call timeout wrapper in `src/chain/rpc.ts`
- [ ] T015 [P] Implement signer from `PRIVATE_KEY` in `src/chain/signer.ts`
- [ ] T016 Implement transaction send/confirm with per-leg retry (3× exponential backoff) in `src/chain/tx.ts`
- [ ] T017 Move and extend `src/vault.ts` → `src/kamino/vault.ts` (shared `Rpc`, `KaminoVault` helpers); re-export from `src/vault.ts` for compatibility
- [ ] T018 [P] Update `src/constants.ts` with example vault addresses only; remove hard-coded production user from runtime path
- [ ] T019 Add `cycleInFlight` mutex helper in `src/cycle/mutex.ts` for overlapping `Bun.cron` ticks

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 2 — Risk-informed allocation decisions (Priority: P1)

**Goal**: Score each vault on risk and compute risk-adjusted target allocations (FR-003, FR-004, FR-005, FR-017)

**Independent Test**: Feed snapshots where highest APY vault has poor risk metrics; verify lower composite score and allocation favoring healthier vault (spec US2 acceptance scenario 1)

### Tests for User Story 2

- [ ] T020 [P] [US2] Unit tests for `computeRiskScore` (liquidity, utilization, concentration, volatility weights) in `tests/unit/risk.test.ts`
- [ ] T021 [P] [US2] Unit tests for `computeTargetAllocations` (sum to 100% − buffer, per-vault caps, critical floor) in `tests/unit/allocate.test.ts`

### Implementation for User Story 2

- [ ] T022 [P] [US2] Implement `VaultMetricsSnapshot` fetch/normalize (APY, TVL, utilization, reserve weights, volatility) in `src/kamino/metrics.ts`
- [ ] T023 [US2] Implement freshness check (`metricsMaxAgeMs`, default 15 min) in `src/kamino/metrics.ts`
- [ ] T024 [US2] Implement `computeRiskScore` and reserve concentration penalty (FR-017) in `src/strategy/risk.ts`
- [ ] T025 [US2] Implement risk-adjusted attractiveness and `TargetAllocation` derivation in `src/strategy/allocate.ts`
- [ ] T026 [US2] Map risk profile presets (`conservative` | `balanced` | `aggressive`) to weights/caps in `src/config/schema.ts` and `src/strategy/allocate.ts`
- [ ] T027 [P] [US2] Integration test for on-chain metrics read path in `tests/integration/vault-read.test.ts` (extend existing `tests/integration/vault.test.ts`)

**Checkpoint**: Scoring and targets computable from metrics without executing trades

---

## Phase 4: User Story 4 — Operational guardrails (Priority: P2)

**Goal**: Enforce min improvement, cooldown, min trade size, max vault %, drift band skip, and critical risk exit override (FR-009) **before** any live execution

**Independent Test**: Below-threshold benefit and within-cooldown scenarios produce skip; critical risk forces exit despite cooldown (spec US4)

**Depends on**: Phase 3 (targets and scores)

### Tests for User Story 4

- [ ] T036 [P] [US4] Unit tests for `shouldRebalance` / warrant logic (including `driftBandPct` within-band skip) in `tests/unit/warrant.test.ts`

### Implementation for User Story 4

- [ ] T037 [US4] Implement `shouldRebalance` with `minImprovementBps`, `cooldownMs`, `minTradeSizeBase`, `driftBandPct` in `src/strategy/warrant.ts`
- [ ] T038 [US4] Implement critical risk exit override (bypass cooldown when `RiskScore.critical`) in `src/strategy/warrant.ts`
- [ ] T039 [US4] Apply `maxSingleVaultPct` and `cashBufferPct` caps when building final targets in `src/strategy/allocate.ts`
- [ ] T040 [US4] Persist `policy_snapshots` hash per cycle in `src/db/schema.ts` and write helper in `src/db/policy.ts`

**Checkpoint**: Guardrails enforced; no on-chain sends until Phase 5+ and orchestrator wires warrant (Phase 6)

---

## Phase 5: User Story 1 — Automated yield-aware rebalancing (Priority: P1)

**Goal**: Compare current vs target allocation and execute withdraw-then-deposit batches when `shouldRebalance` is true (FR-006, FR-007, FR-011 partial)

**Independent Test**: One cycle with known metrics moves capital toward targets when benefit exceeds threshold; skips when yields similar (spec US1)

**Depends on**: Phase 3 (targets and scores), Phase 4 (warrant / guardrails)

### Tests for User Story 1

- [ ] T028 [P] [US1] Unit tests for leg planning (only when warrant true) in `tests/unit/execute.test.ts`
- [ ] T029 [P] [US1] Integration test building `withdrawIxs` / `depositIxs` without send in `tests/integration/deposit-ix-build.test.ts`

### Implementation for User Story 1

- [ ] T030 [US1] Implement `reconcilePositions` → `WalletPosition` in `src/kamino/reconcile.ts` (wallet balance + per-vault shares)
- [ ] T031 [US1] Plan `RebalanceAction[]` (withdraw phase then deposit) in `src/cycle/execute.ts` only when `shouldRebalance()` returns true (Phase 4)
- [ ] T032 [US1] Wire withdraw phase: `withdrawIxs` + `src/chain/tx.ts` send/confirm in `src/cycle/execute.ts`
- [ ] T033 [US1] Wire deposit phase after withdrawal phase completes in `src/cycle/execute.ts`
- [ ] T034 [US1] On partial leg failure or cycle abort: end cycle immediately, no same-cycle retries (FR-011) in `src/cycle/execute.ts`
- [ ] T035 [US1] Export `computeMaxDriftPct(position, targets)` for FR-013 drift trigger reuse in `src/kamino/reconcile.ts` or `src/strategy/warrant.ts`

**Checkpoint**: Execution modules ready; **no live mainnet txs until Phase 6 orchestrator + explicit `PREVIEW_MODE=false`** (see quickstart)

---

## Phase 6: User Story 3 — Safe, observable operations (Priority: P2)

**Goal**: Preview mode, decision audit logs, reconcile-before-plan after failures (FR-008, FR-010, FR-011)

**Independent Test**: `PREVIEW_MODE=true` produces full decision record with no on-chain txs; next cycle reconciles after simulated partial failure (spec US3)

**Depends on**: Phase 4–5 (warrant before execute; orchestrator wires both)

### Tests for User Story 3

- [ ] T041 [P] [US3] Unit tests for `runCycle` preview path and decision log persistence in `tests/unit/cycle-preview.test.ts`
- [ ] T042 [P] [US3] Unit tests for reconcile-first ordering after `partial` / `timeout` status in `tests/unit/cycle-reconcile.test.ts`

### Implementation for User Story 3

- [ ] T043 [US3] Implement `runCycle(ctx): Promise<CycleResult>` orchestrator per `contracts/cycle-api.md` in `src/cycle/runner.ts`
- [ ] T044 [US3] Implement preview branch: plan legs, log rationale, skip `send*` (FR-008) in `src/cycle/runner.ts`
- [ ] T045 [US3] Persist `DecisionLog` (inputs, scores, targets, actions, outcome, rationale) in `src/db/decision.ts`
- [ ] T046 [US3] Always call `reconcilePositions` at cycle start before planning in `src/cycle/runner.ts`
- [ ] T047 [US3] Implement one-shot cycle CLI entry in `src/cli.ts` (`bun run src/cli.ts cycle`)
- [ ] T048 [US3] Refactor `src/index.ts` to load config and invoke single preview/live cycle for manual smoke test

**Checkpoint**: Preview cycles produce parseable audit logs; reconcile runs every cycle start

---

## Phase 7: User Story 5 — Resilience and alerting (Priority: P3)

**Goal**: Dependency vs execution holds, stale data / RPC timeouts, alerts, cron + drift scheduling (FR-012, FR-013, FR-019–FR-022)

**Independent Test**: Stale metrics → dependency hold, no trade; 3 failing cycles → execution hold until `ack-hold` (spec US5)

**Depends on**: Phase 6 (`runCycle` exists)

### Tests for User Story 5

- [ ] T049 [P] [US5] Unit tests for hold state machine (dependency auto-resume vs execution ack) in `tests/unit/cycle-hold.test.ts`
- [ ] T050 [P] [US5] Unit tests for cycle timeout abort and consecutive failure counter in `tests/unit/cycle-timeout.test.ts`
- [ ] T071 [P] [US5] Unit tests for drift trigger (enabled/disabled, band exceeded, mutex with cron) in `tests/unit/drift-trigger.test.ts`

### Implementation for User Story 5

- [ ] T051 [US5] Implement dependency vs execution hold persistence in `src/cycle/hold.ts`
- [ ] T052 [US5] Skip trading on stale metrics, RPC timeout, vault unavailable; auto-clear dependency hold when healthy in `src/cycle/runner.ts`
- [ ] T053 [US5] Enter execution hold after 3 consecutive cycles with ≥1 failed tx; require ack to resume in `src/cycle/hold.ts`
- [ ] T054 [US5] Implement `acknowledgeExecutionHold` CLI (`bun run src/cli.ts ack-hold`) in `src/cli.ts`
- [ ] T055 [US5] Enforce `cycleTimeoutMs` (default 3 min) via `AbortSignal` in `src/cycle/runner.ts`
- [ ] T056 [US5] Implement structured alert emission per `contracts/alerts.md` in `src/alerts/emit.ts`
- [ ] T072 [US5] Implement `startDriftTrigger(ctx)` in `src/cycle/drift-trigger.ts` (FR-013): when `driftTriggerEnabled`, poll reconcile + `computeMaxDriftPct`; invoke `runCycle` if drift > `policy.driftBandPct`
- [ ] T057 [US5] Register `Bun.cron` with `CRON_EXPRESSION` and `startDriftTrigger` when enabled; share `cycleInFlight` mutex in `src/index.ts`
- [ ] T058 [US5] Optional `ALERT_WEBHOOK_URL` POST (non-blocking) in `src/alerts/emit.ts`

**Checkpoint**: Daemon runs on cron (+ optional drift poll); holds and alerts behave per FR-019/FR-021

---

## Phase 8: User Story 6 — Historical evaluation (Priority: P3)

**Goal**: Backtest allocation logic over historical metrics without live trades (FR-016)

**Independent Test**: Fixed historical window produces cumulative risk-adjusted return vs equal-weight baseline (spec US6)

**Depends on**: Phase 3 (strategy modules)

### Tests for User Story 6

- [ ] T059 [P] [US6] Unit tests for backtest runner (no `send*`, frozen policy) in `tests/unit/backtest.test.ts`

### Implementation for User Story 6

- [ ] T060 [US6] Implement Kamino API historical metrics import with shared Zod snapshot schema in `src/kamino/metrics-history.ts`
- [ ] T061 [US6] Persist imported snapshots to `metric_snapshots` for replay in `src/db/metrics.ts`
- [ ] T062 [US6] Implement `runBacktest(opts): Promise<BacktestReport>` per `contracts/cycle-api.md` in `src/cycle/backtest.ts`
- [ ] T063 [US6] Add CLI entry `bun run src/cli.ts backtest` in `src/cli.ts`
- [ ] T064 [US6] Output summary: cumulative risk-adjusted return vs equal-weight baseline in `src/cycle/backtest.ts`

**Checkpoint**: Backtest runs offline with tunable risk weights

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality gates, and quickstart validation

- [ ] T065 [P] Update `README.md` with env vars, cron daemon, DB migrate, preview/live, ack-hold, integration test flags per `quickstart.md`
- [ ] T066 Remove deprecated `src/config.ts` after all imports use `src/config/load.ts`
- [ ] T067 Run `bun pm ls | grep @solana/kit` and document single 2.3.x tree in `README.md`
- [ ] T068 Run full quality gate: `bun run compile`, `bun run check`, `bun test`, `RUN_INTEGRATION_TESTS=true bun test` (when RPC configured)
- [ ] T069 Validate operator quickstart flow end-to-end per `specs/001-vault-yield-rebalance/quickstart.md`
- [ ] T070 [P] Add anomaly guard: APY spike vs trailing average threshold in `src/kamino/metrics.ts` (edge case from spec)

---

## Dependencies & Execution Order

### Phase Dependencies

| Phase | Depends on | Delivers |
|-------|------------|----------|
| 1 Setup | — | Tooling, dirs, deps |
| 2 Foundational | 1 | Config, DB, chain, vault adapter |
| 3 US2 | 2 | Risk scores + targets |
| 4 US4 | 3 | Warrant / guardrails |
| 5 US1 | 3, 4 | Withdraw/deposit execution |
| 6 US3 | 4, 5 | `runCycle`, preview, logs |
| 7 US5 | 6 | Cron, holds, alerts |
| 8 US6 | 3 | Backtest |
| 9 Polish | All desired stories | README, validation |

### User Story Dependencies

- **US2 (P1)**: After Foundational — no other story dependencies
- **US4 (P2)**: After US2 (warrant before execution)
- **US1 (P1)**: After US2 + US4 (execution gated by `shouldRebalance`)
- **US3 (P2)**: After US4 + US1 (orchestrates full cycle)
- **US5 (P3)**: After US3 (`runCycle` host)
- **US6 (P3)**: After US2 strategy; parallel to US5 once metrics DB exists

### Within Each User Story

- Tests written to fail before or alongside implementation
- Strategy (US2) → guardrails (US4) → execution (US1)
- Orchestration (US3) before scheduling/holds/drift trigger (US5)

### Parallel Opportunities

- **Phase 1**: T002–T007 marked [P]
- **Phase 2**: T010, T014–T015, T018 in parallel after T008–T009
- **Phase 3**: T020–T021, T027 in parallel
- **Phase 4**: T036 in parallel
- **Phase 5**: T028–T029 in parallel
- **After Phase 2**: US2 and DB metric import (T060–T061) can start early for US6
- **Phase 9**: T065, T070 in parallel

---

## Parallel Example: User Story 2

```bash
# Tests in parallel:
tests/unit/risk.test.ts
tests/unit/allocate.test.ts

# After T022 metrics module:
src/strategy/risk.ts
src/strategy/allocate.ts  # sequential: allocate depends on risk scores
```

---

## Parallel Example: User Story 4 → User Story 1

```bash
# Phase 4 first:
tests/unit/warrant.test.ts
src/strategy/warrant.ts

# Phase 5 then:
tests/unit/execute.test.ts
tests/integration/deposit-ix-build.test.ts
src/kamino/reconcile.ts → src/cycle/execute.ts (warrant check → withdraw → deposit)
```

---

## Implementation Strategy

### MVP First (User Stories 2 + 4 + 1 + 3 preview)

1. Complete Phase 1–2 (Setup + Foundational)
2. Complete Phase 3 (US2 scoring/targets)
3. Complete Phase 4 (US4 guardrails) — **before any live execution**
4. Complete Phase 5 (US1 execution modules)
5. Complete Phase 6 (US3 preview + logs) — **STOP and validate** with `PREVIEW_MODE=true`
6. Enable live only after preview trusted and explicit `PREVIEW_MODE=false`

### Incremental Delivery

| Increment | Stories | Operator value |
|-----------|---------|----------------|
| MVP | US2 + US4 + US1 + US3 (preview) | See decisions without risking funds |
| v1 live | + US5 | Cron + optional drift trigger; holds |
| v1.1 | + US6 | Tune policy via backtest |

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Developer A: US2 strategy + tests
3. Developer B: Foundational chain/DB (Phase 2) then US4 warrant, then US1 execution
4. After US3: Developer C: US5 ops; Developer D: US6 backtest

---

## Notes

- Existing `src/vault.ts`, `src/config.ts`, `tests/integration/vault.test.ts` are migrated, not rewritten from scratch
- `PREVIEW_MODE` defaults to `true` when unset (FR-008, `config.schema.json`, quickstart)
- Implement US4 (Phase 4) before enabling live execution (US1 Phase 5)
- `DRIFT_TRIGGER_ENABLED=false` by default; enable for FR-013 extra cycles
- Do not add `@solana/web3.js` 1.x; Kit 2.3.x only
- Commit after each task or logical group; stop at any **Checkpoint** to validate story independently
