# Feature Specification: Kamino Vault Yield Rebalancer

**Feature Branch**: `001-vault-yield-rebalance`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "Write a typescript bot that reallocates between 3 Kamino lending vaults to maximize yield. Open ended. Decide what extra features you would implement and why. It will balance return together with risk assessment."

## Clarifications

### Session 2026-05-20

- Q: After partial transaction success (e.g., withdraw succeeds, deposit fails), should the bot retry in the same cycle or defer? → A: Next-cycle reconcile — end the cycle after partial success; next cycle reconciles on-chain positions and plans fresh moves (no same-cycle retries).
- Q: What is the maximum age of vault metrics before they are considered stale? → A: 15 minutes (default, operator-configurable).
- Q: When should the bot enter hold state after transaction failures? → A: After 3 consecutive cycles each ending with at least one failed transaction; automated execution pauses until operator acknowledgment.
- Q: What is the maximum wall-clock duration for one rebalance cycle? → A: 3 minutes (default, operator-configurable); abort remainder and log timeout if exceeded.
- Q: What is the per-call timeout for RPC and metric API requests? → A: 15 seconds (default, operator-configurable); treat timed-out calls as connectivity failures per FR-012.
- Q: Does auto-resume after hold conflict with operator acknowledgment for tx failures? → A: Split by cause — dependency holds (stale data, connectivity, vault unavailable) auto-resume when checks pass; execution holds (3 consecutive failing cycles) require operator acknowledgment.
- Q: What is the multi-vault move sequencing within one cycle? → A: Withdraw-then-deposit batch — all planned withdrawals first, then all planned deposits (wallet as hub).
- Q: What happens when the cycle timeout fires mid-execution? → A: Abort like partial failure — end cycle immediately, no further legs, reconcile next cycle (no same-cycle retries).
- Q: How many in-cycle retries for a fully failed transaction? → A: 3 retries with exponential backoff per leg (default, configurable); no retries after partial success.
- Q: What is the default for preview mode when unset? → A: `true` (safe default); live execution requires explicit `PREVIEW_MODE=false`.
- Q: How does optional drift-triggered evaluation work (FR-013)? → A: When `driftTriggerEnabled`, a background poll (default 5 min) reconciles positions and runs a full cycle if any vault’s allocation drift exceeds `policy.driftBandPct`; shares `cycleInFlight` mutex with cron. When disabled, evaluation runs on cron only.
- Q: Does `driftBandPct` serve multiple roles? → A: Yes—same field for (1) optional FR-013 extra cycle trigger and (2) within-band skip / churn avoidance in warrant logic (FR-009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automated yield-aware rebalancing (Priority: P1)

As the bot operator, I want deposited capital automatically spread across three Kamino Earn vaults so that expected yield is maximized without exceeding my risk tolerance, so I earn more than leaving funds idle in a single vault.

**Why this priority**: This is the core value proposition—moving capital to better risk-adjusted opportunities without manual monitoring.

**Independent Test**: Configure three vaults and a funded wallet; run one evaluation cycle with known vault metrics; verify the bot proposes or executes allocation changes only when projected risk-adjusted benefit exceeds configured thresholds.

**Acceptance Scenarios**:

1. **Given** capital is concentrated in one vault and two others offer higher risk-adjusted yield, **When** a rebalance cycle runs, **Then** the bot moves funds toward the target allocation within policy limits.
2. **Given** all three vaults offer similar risk-adjusted yield, **When** a rebalance cycle runs, **Then** the bot does not trade (no unnecessary churn).
3. **Given** a rebalance is warranted, **When** execution completes successfully, **Then** post-trade allocations match the target within the configurable tolerance band `policy.driftBandPct` (default 2% in balanced profile).

---

### User Story 2 - Risk-informed allocation decisions (Priority: P1)

As the bot operator, I want each vault scored for risk alongside return so allocations favor stable, sustainable yield over headline APY alone, so I avoid concentrating in fragile or illiquid strategies.

**Why this priority**: Yield-only optimization can park funds in vaults that spike APY before stress events; risk scoring is explicit in the user request.

**Independent Test**: Feed vault metric snapshots where the highest APY vault has poor risk indicators; verify the bot ranks it below a lower-APY, lower-risk vault and allocates accordingly.

**Acceptance Scenarios**:

1. **Given** Vault A has the highest APY but high utilization and low TVL, **When** scores are computed, **Then** Vault A receives a lower composite score than a moderate-APY vault with healthier metrics.
2. **Given** operator sets a conservative risk profile, **When** targets are calculated, **Then** no single vault exceeds the configured maximum allocation percentage.
3. **Given** a vault’s risk score crosses a critical threshold, **When** a cycle runs, **Then** the bot reduces or eliminates exposure to that vault even if APY remains attractive.

---

### User Story 3 - Safe, observable operations (Priority: P2)

As the bot operator, I want every decision logged with rationale and the ability to preview actions before they execute, so I can trust, audit, and recover from failures.

**Why this priority**: On-chain capital movement requires transparency; dry-run and audit trails reduce operational risk before scaling automation.

**Independent Test**: Run in preview mode; confirm logs show current allocation, scores, target allocation, and planned moves with no on-chain state change.

**Acceptance Scenarios**:

1. **Given** preview mode is enabled, **When** a cycle runs, **Then** no deposits or withdrawals are submitted and a human-readable decision record is produced.
2. **Given** a prior rebalance failed mid-flight, **When** the next cycle runs, **Then** the bot reconciles on-chain positions before planning new moves.
3. **Given** an operator reviews logs after a week, **When** they search by date, **Then** they can reconstruct why each trade did or did not occur.

---

### User Story 4 - Operational guardrails (Priority: P2)

As the bot operator, I want limits on trade frequency, size, and cooldowns so the bot cannot churn capital or over-concentrate during volatile periods.

**Why this priority**: Rebalancing has costs (fees, slippage, opportunity cost of failed txs); guardrails protect capital and reputation.

**Independent Test**: Configure minimum benefit threshold and cooldown; trigger conditions that would rebalance twice within cooldown; verify only the first eligible trade executes.

**Acceptance Scenarios**:

1. **Given** projected benefit is below the minimum improvement threshold, **When** a cycle runs, **Then** no trade is attempted.
2. **Given** a successful rebalance occurred within the cooldown window, **When** a cycle runs, **Then** the bot skips execution unless a critical risk exit applies.
3. **Given** a proposed move would exceed max single-vault allocation, **When** targets are computed, **Then** the allocation is capped and excess stays in safer vaults or cash buffer per policy.

---

### User Story 5 - Resilience and alerting (Priority: P3)

As the bot operator, I want the bot to detect unhealthy dependencies (stale data, connectivity, vault constraints) and notify me when it cannot act safely, so I am not silently exposed to drift or missed exits.

**Why this priority**: DeFi automation fails quietly without health checks; alerts close the loop for unattended operation.

**Independent Test**: Simulate stale metrics or RPC unavailability; verify the bot enters a safe hold state and emits a clear alert.

**Acceptance Scenarios**:

1. **Given** vault metrics are older than 15 minutes (default freshness limit, operator-configurable), **When** a cycle runs, **Then** the bot does not trade and records a data-stale alert.
2. **Given** three consecutive cycles each end with at least one failed transaction, **When** the third such cycle completes, **Then** the bot enters an execution hold, pauses live execution, and requires operator acknowledgment before resuming.
3. **Given** the bot is in a dependency hold (stale metrics, connectivity failure, or vault unavailable), **When** all dependency checks pass on a subsequent cycle, **Then** normal evaluation and trading resume automatically without operator acknowledgment or redeploy.
4. **Given** the bot is in an execution hold, **When** the operator provides acknowledgment, **Then** live execution resumes on the next cycle without redeploy.

---

### User Story 6 - Historical evaluation (Priority: P3)

As the bot operator, I want to replay past vault metrics through the allocation logic to estimate how the strategy would have behaved, so I can tune risk weights before deploying more capital.

**Why this priority**: Open-ended scope benefits from evidence-based tuning; backtesting de-risks parameter choices without live capital.

**Independent Test**: Run evaluation over a fixed historical window with frozen policy; produce summary of would-have allocations vs. a static baseline.

**Acceptance Scenarios**:

1. **Given** historical metric snapshots for all three vaults, **When** backtest mode runs, **Then** outputs include cumulative risk-adjusted return vs. equal-weight baseline.
2. **Given** backtest completes, **When** operator adjusts risk weights, **Then** a new run reflects updated policy without changing live configuration.

---

### Edge Cases

- **Vault withdrawal blocked** (liquidity cap, pause, or program constraint): treat as dependency failure for that cycle, abort remaining execution in that cycle, emit `vault_unavailable`, and enter dependency hold until checks pass.
- **Partial transaction success** (e.g., withdraw succeeds, deposit fails): the current cycle ends immediately after the failed leg; no same-cycle retries. The next cycle MUST reconcile on-chain wallet and vault positions before planning new moves.
- **Cycle timeout during execution** (FR-020): same as partial failure—the cycle ends immediately, no further legs run, no same-cycle retries; the next cycle reconciles before planning new moves.
- **Anomalous APY divergence/spike**: mark the metric snapshot as invalid for trading when APY exceeds `apySpikeGuardMultiple` times trailing average (default 3x, operator-configurable); skip trade and enter dependency hold for that cycle.
- **Wallet balance below minimum trade size**: if every candidate rebalance leg is below `policy.minTradeSizeBase`, skip trading and log `rebalance_skipped` with `reason=min_trade_size`.
- **Overlapping reserves across vaults**: apply cross-vault reserve concentration penalty (FR-017) using combined reserve weights to reduce attractiveness for correlated allocations.
- How does the system respond to sudden TVL collapse or utilization spike in a currently overweight vault?
- **Policy or vault-list changes in-flight**: freeze an immutable policy snapshot at cycle start; apply updates only from the next cycle onward; in-flight cycle logs `policyHash` used for determinism/audit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST monitor exactly three configurable Kamino Earn vaults per deployment instance.
- **FR-002**: System MUST ingest, at minimum, net yield (APY or equivalent), total value locked, utilization, and share of capital per underlying reserve for each vault.
- **FR-003**: System MUST compute a composite risk score per vault using operator-configurable weights across factors including liquidity depth (TVL), utilization stress, reserve concentration, and recent yield volatility.
- **FR-004**: System MUST compute a risk-adjusted attractiveness score for ranking vaults as `attractiveness = expectedNetApy * compositeRiskScore` (higher is better), where both terms are from the same metrics snapshot timestamp.
- **FR-005**: System MUST derive target allocation percentages across the three vaults that sum to `100 - cashBufferPct` of deployable capital, subject to per-vault min/max caps and profile constraints.
- **FR-006**: System MUST compare current on-chain allocation to target allocation and determine whether rebalancing is warranted using measurable criteria: rebalance when `maxAbsDriftPct > policy.driftBandPct` AND projected improvement is `>= policy.minImprovementBps`, unless critical-risk exit override applies.
- **FR-007**: System MUST execute withdraw-and-deposit sequences to move capital toward targets when warranted and not in preview mode; within a single cycle, execution MUST follow withdraw-then-deposit batch order—all planned withdrawals from overweight vaults to the operator wallet complete (or the withdrawal phase ends due to failure, partial success, or timeout) before any deposits to underweight vaults begin.
- **FR-008**: System MUST support preview mode where all decisions are logged but no capital movement occurs. When `PREVIEW_MODE` is unset, the loader MUST default to preview enabled (`true`); live execution requires an explicit operator opt-in (`PREVIEW_MODE=false`).
- **FR-009**: System MUST enforce operator-configurable policies: minimum improvement to rebalance, maximum allocation per vault, minimum trade size, rebalance cooldown, within-band skip (`driftBandPct`), and critical risk exit override.
- **FR-010**: System MUST record each cycle with a complete immutable decision log containing at minimum: `cycleId`, `timestamp`, `policyHash`, `inputs` (metrics snapshot + freshness), `scores`, `targets`, `actions` (planned/executed), `actionTaken` (`trade|skip|hold|timeout|preview`), `outcome`, and human-readable `rationale`.
- **FR-011**: System MUST reconcile actual wallet and vault positions before planning trades after any failed, partial, or timed-out execution; partial success and cycle timeout MUST NOT trigger same-cycle retries—the affected cycle ends and reconciliation runs at the start of the next cycle.
- **FR-012**: System MUST skip trading when data freshness, connectivity, or vault availability checks fail, and record the reason; metrics older than 15 minutes (default, operator-configurable) MUST be treated as stale; RPC and metric API calls exceeding 15 seconds (default, operator-configurable) MUST be treated as connectivity failures.
- **FR-013**: System MUST support scheduled periodic evaluation (default: every 15 minutes via `Bun.cron`, `CRON_EXPRESSION=*/15 * * * *` when unset) and optional threshold-triggered evaluation: when `driftTriggerEnabled` is true, a background poll (default interval 5 minutes, operator-configurable) reconciles on-chain positions and invokes a full rebalance cycle when any vault’s absolute allocation drift exceeds `policy.driftBandPct` (same band used for within-band skip in FR-009). Drift-triggered cycles MUST respect the same `cycleInFlight` mutex, hold states, and guardrails as cron-triggered cycles. When `driftTriggerEnabled` is false (default), drift is evaluated only on scheduled cron ticks.
- **FR-014**: System MUST allow operators to define risk profile presets (`conservative`, `balanced`, `aggressive`) that map to concrete defaults for risk weights, `maxSingleVaultPct`, `cashBufferPct`, `criticalRiskFloor`, `minImprovementBps`, `cooldownMs`, and `driftBandPct`; defaults MUST be documented and overrideable.
- **FR-015**: System MUST emit operator-visible alerts with structured payload `{event,timestamp,cycleId,message,details}` for at least: `metrics_stale`, `rpc_timeout`, `vault_unavailable`, `dependency_hold_entered`, `dependency_hold_cleared`, `execution_hold_entered`, `critical_risk_exit`, `cycle_timeout`, `tx_leg_failed`, `rebalance_executed`, and `rebalance_skipped`.
- **FR-019**: System MUST support two hold types: **dependency hold** (stale metrics, connectivity failure, vault unavailable)—skip live trading until checks pass and auto-resume on recovery without operator acknowledgment; **execution hold**—enter after three consecutive cycles each ending with at least one failed transaction (configurable threshold, default 3), pause live execution, and resume only after operator acknowledgment.
- **FR-020**: System MUST enforce a maximum wall-clock duration of 3 minutes per rebalance cycle (default, operator-configurable); if exceeded, end the cycle immediately per FR-011 (no further legs, no same-cycle retries), skip remaining execution, and record a cycle-timeout outcome in the decision log.
- **FR-022**: System MUST retry fully failed transactions (no on-chain confirmation) up to 3 times with exponential backoff per leg (default, configurable) before marking the leg failed; retries MUST NOT apply after partial success (e.g., confirmed withdraw with failed deposit) or after cycle timeout abort.
- **FR-023**: After any agent-driven code change, the delivery workflow MUST run `bun run format`, then `bun run check` with zero warnings/errors, then `bun run test`, then `bun run test:integration`; all four commands MUST pass before merge or handoff.
- **FR-021**: System MUST apply a 15-second timeout (default, operator-configurable) to each Solana RPC and Kamino metric API request; timed-out requests MUST NOT block the cycle beyond the timeout and MUST be logged with the failing dependency identifier.
- **FR-016**: System SHOULD support historical replay (backtest) of allocation decisions using stored or fetched metric history without submitting live trades.
- **FR-017**: System SHOULD detect correlated exposure when multiple vaults allocate heavily to the same underlying reserve and apply a concentration penalty to composite risk; default penalty proxy is derived from combined reserve overlap across managed vaults and MUST be testable with fixture snapshots.
- **FR-018**: System SHOULD maintain a small unallocated buffer (configurable, default 0–5%) to absorb rounding and reduce failed full redeployment.

### Key Entities

- **Vault**: A Kamino Earn vault under management; attributes include identifier, human label, current position size, and latest metrics.
- **Vault Metrics Snapshot**: Point-in-time measurements (yield, TVL, utilization, reserve breakdown, timestamp) used for scoring; snapshots older than the freshness limit (default 15 minutes) are invalid for trading decisions.
- **Risk Score**: Normalized assessment of vault fragility derived from weighted risk factors.
- **Target Allocation**: Desired percentage or amount per vault after optimization.
- **Rebalance Policy**: Operator rules governing when and how much the bot may trade (thresholds, caps, cooldowns, profiles).
- **Rebalance Cycle**: One end-to-end evaluation from data fetch through decision to execution or skip; MUST complete within 3 minutes wall-clock (default, operator-configurable) or abort with a logged timeout.
- **Rebalance Action**: Planned or executed movement of capital between vaults (withdraw, deposit, or none); within a cycle, withdrawals precede deposits per FR-007.
- **Hold State**: Paused or restricted execution mode; **dependency hold** auto-resumes when health checks pass; **execution hold** requires operator acknowledgment after repeated transaction failures per FR-019.
- **Decision Log**: Immutable audit record for a cycle including rationale and outcomes.
- **Operator Wallet**: Funded account whose vault positions the bot manages.

### Risk Profile Preset Defaults

| Profile | maxSingleVaultPct | cashBufferPct | criticalRiskFloor | minImprovementBps | cooldownMs | driftBandPct |
|---------|-------------------:|--------------:|------------------:|------------------:|-----------:|-------------:|
| conservative | 40 | 5 | 0.25 | 35 | 21,600,000 (6h) | 2 |
| balanced | 50 | 3 | 0.20 | 25 | 21,600,000 (6h) | 2 |
| aggressive | 60 | 0 | 0.15 | 15 | 14,400,000 (4h) | 3 |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over a 30-day observation window with live or paper-tracked metrics, risk-adjusted portfolio yield (return minus risk-penalty proxy) meets or exceeds equal-weight allocation across the same three vaults by at least 5% relative improvement.
- **SC-002**: In preview mode, 100% of cycles produce a complete decision log (inputs, scores, targets, action) parseable without manual chain inspection.
- **SC-003**: When no vault offers at least the configured minimum improvement over current allocation, the bot skips trading in at least 90% of cycles under **stable conditions** defined as: no stale metrics, no dependency hold, per-vault APY changes within ±10% relative over the last 24 consecutive scheduled evaluation cycles, and no critical-risk triggers.
- **SC-004**: After simulated or injected partial-failure scenarios, the bot reaches a **consistent known position state** within one subsequent cycle, meaning reconciled position totals equal on-chain balances/shares within `policy.driftBandPct`, with no duplicate conflicting legs for the same vault and phase.
- **SC-005**: Critical risk exits (vault risk score below floor) trigger reduction of exposure within one evaluation cycle when metrics are no older than the freshness limit (default 15 minutes) and connectivity is healthy.
- **SC-006**: Operators can complete initial setup (three vaults, policy, preview run) and review first decision output in under 15 minutes using provided documentation.
- **SC-007**: Under **normal mainnet conditions** (healthy RPC SLA, no major Solana incident, no prolonged Kamino outage), at least 95% of rebalance cycles complete (fetch, score, decide, and execute or skip) within the 3-minute cycle budget without timing out, measured over at least 500 consecutive cycles in a rolling 30-day window.

## Assumptions

- The operator controls a single funded wallet used for all three vault positions on Solana mainnet.
- The three vaults are Kamino Earn (K-Vault) products sharing a broadly similar deposit asset (e.g., USDC or USDS stablecoin strategies); cross-asset vaults are out of scope for v1.
- Vault identifiers and RPC access are supplied via environment or configuration; the bot does not discover vaults automatically in v1.
- Yield and risk metrics are sourced from Kamino’s public data surfaces; the specification does not mandate a particular integration method.
- Transaction signing uses the operator’s private key stored securely outside the repository; key management UI is out of scope.
- v1 targets unattended periodic operation with logging; a full web dashboard is optional (P3 reporting may be CLI/log files only).
- Legal and regulatory compliance for automated DeFi trading remain the operator’s responsibility.
- Existing project scaffolding (config loading, vault read helpers) will be extended rather than replaced.

## Scope

### In scope (prioritized)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| P1 | Risk-adjusted scoring and target allocation | Core differentiator vs. naive APY chasing |
| P1 | Automated withdraw/deposit rebalancing | Delivers yield optimization outcome |
| P2 | Preview mode and decision audit logs | Safety and trust for capital movement |
| P2 | Guardrails (thresholds, caps, cooldown) | Prevents fee churn and concentration |
| P2 | Position reconciliation after failures | Required for reliable automation |
| P3 | Health checks, hold state, alerts | Unattended operational safety |
| P3 | Historical replay / backtest | Evidence-based policy tuning |

### Out of scope (v1)

- Managing more or fewer than three vaults per instance
- Borrow/lend or multiply positions (non–Earn vault products)
- Cross-chain or bridge operations
- Socialized pooling of multiple operator wallets
- On-chain governance or curator vault creation
- Tax reporting and accounting integrations

## Dependencies

- Reliable access to Solana mainnet (RPC) and Kamino vault metric data; RPC and metric endpoints MUST respond within configured per-call timeouts (default 15 seconds) under normal conditions
- Operator wallet funded with deposit asset and existing or zero vault positions
- Kamino program availability and vault liquidity for withdrawals

## Extra Features (recommended) — What and Why

| Feature | Priority | Why |
|---------|----------|-----|
| Risk-adjusted scoring (not APY-only) | P1 | Prevents allocation to fragile high-APY vaults; directly satisfies user goal |
| Rebalance guardrails | P2 | Reduces fee drag and over-trading; improves net yield |
| Preview / dry-run mode | P2 | Lets operators validate logic before risking capital |
| Decision audit logs | P2 | Essential for debugging and regulatory-style self audit |
| Reserve concentration penalty | P2 | Three vaults may share underlying reserves; hidden correlation is a major DeFi risk |
| Hold state + alerts | P3 | Fails safe when data or chain is unhealthy |
| Backtest / historical replay | P3 | Open-ended tuning needs measurable feedback without live experiments |
