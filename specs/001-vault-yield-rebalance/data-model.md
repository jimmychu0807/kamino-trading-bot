# Data Model: Kamino Vault Yield Rebalancer

**Branch**: `001-vault-yield-rebalance` | **Date**: 2026-05-20

## Entity relationship overview

```text
OperatorConfig ──< VaultConfig (exactly 3)
       │
       ├── RebalancePolicy
       └── RiskProfilePreset

RebalanceCycle ──< VaultMetricsSnapshot (3)
       │          RiskScore (3)
       │          TargetAllocation
       ├── RebalanceAction[] (0..n)
       └── DecisionLog (1)

HoldState ── optional active record per deployment
WalletPosition ── derived each cycle (not persisted long-term except snapshots)
```

---

## VaultConfig

Configurable Kamino Earn (K-Vault) under management.

| Field | Type | Rules |
|-------|------|-------|
| `address` | `Address` (base58 string) | Required; unique among the three |
| `label` | string | Optional display name |
| `minAllocationPct` | number 0–100 | Default 0 |
| `maxAllocationPct` | number 0–100 | Default per risk profile; ≤ 100 |
| `enabled` | boolean | Default true |

**Validation**: Exactly three vaults in `VaultConfig[]`; sum of mins ≤ 100; each max ≥ min.

---

## VaultMetricsSnapshot

Point-in-time metrics for scoring (FR-002).

| Field | Type | Rules |
|-------|------|-------|
| `vaultAddress` | Address | FK to VaultConfig |
| `capturedAt` | ISO datetime | Required |
| `netApy` | decimal | ≥ 0 |
| `tvlUsd` | decimal | ≥ 0 |
| `utilization` | decimal 0–1 | Optional if unavailable |
| `reserveWeights` | `{ reserveAddress, weightPct }[]` | For concentration (FR-017) |
| `yieldVolatility` | decimal | Trailing window; computed |
| `source` | `chain` \| `api` | Audit trail |
| `fresh` | boolean | `capturedAt` within `metricsMaxAgeMs` |

**State**: Invalid when `fresh === false` → triggers dependency hold (FR-012).

---

## RiskScore

Normalized fragility score per vault per cycle (FR-003).

| Field | Type | Rules |
|-------|------|-------|
| `vaultAddress` | Address | |
| `liquidityScore` | 0–1 | Higher = safer |
| `utilizationScore` | 0–1 | |
| `concentrationScore` | 0–1 | Penalize shared reserves |
| `volatilityScore` | 0–1 | |
| `composite` | 0–1 | Weighted sum from policy |
| `critical` | boolean | `composite < criticalFloor` → force exit (FR-009) |

---

## TargetAllocation

Desired deployable capital split (FR-005).

| Field | Type | Rules |
|-------|------|-------|
| `vaultAddress` | Address | |
| `targetPct` | decimal | 0–100 |
| `targetAmount` | bigint (lamports/base units) | Derived from wallet deployable |
| `attractiveness` | decimal | risk-adjusted score (FR-004) |

**Validation**: Σ `targetPct` = 100 − `cashBufferPct` (FR-018, default 0–5%).

---

## WalletPosition

Reconciled on-chain state at cycle start (FR-011).

| Field | Type | Rules |
|-------|------|-------|
| `walletAddress` | Address | Operator wallet |
| `tokenBalance` | bigint | Deposit asset in wallet (raw on-chain) |
| `vaultShares` | `{ vaultAddress, shares, valueBase }[]` | Per vault |
| `totalOnChain` | bigint | `tokenBalance` + Σ vault `valueBase` (audit) |
| `walletBalanceCounted` | bigint | Wallet portion used in strategy (may be capped by `maxAllocationBase`) |
| `totalDeployable` | bigint | Effective deployable: Σ vault values + `walletBalanceCounted` |

---

## RebalancePolicy

Operator rules (FR-009, FR-014).

| Field | Type | Default |
|-------|------|---------|
| `minImprovementBps` | number | e.g. 25 |
| `maxSingleVaultPct` | number | 50 (profile-dependent) |
| `minTradeSizeBase` | bigint | economically viable floor |
| `cooldownMs` | number | e.g. 6h |
| `driftBandPct` | number | e.g. 2; FR-013 drift trigger + FR-009 within-band skip |
| `cashBufferPct` | number | 0–5 |
| `criticalRiskFloor` | number | 0.2 |
| `riskWeights` | object | liquidity, utilization, concentration, volatility |
| `profile` | `conservative` \| `balanced` \| `aggressive` | `balanced` |

---

## RebalanceCycle

One evaluation run (FR-020: max 3 min wall-clock).

| Field | Type | Rules |
|-------|------|-------|
| `id` | uuid | Primary key |
| `startedAt` / `endedAt` | datetime | |
| `status` | enum | `completed`, `skipped`, `preview`, `dependency_hold`, `execution_hold`, `timeout`, `partial` |
| `previewMode` | boolean | |
| `consecutiveFailureCount` | number | Rolling; reset on full success |

**Transitions**:
- `running` → `completed` | `skipped` | `preview` | `timeout` | `partial`
- `partial` → next cycle starts with `reconcile` → new cycle
- 3 consecutive cycles with ≥1 failed tx → `execution_hold` (FR-019)

---

## RebalanceAction

Planned or executed leg (FR-007).

| Field | Type | Rules |
|-------|------|-------|
| `cycleId` | uuid | |
| `vaultAddress` | Address | |
| `kind` | `withdraw` \| `deposit` \| `none` | |
| `phase` | `withdrawal` \| `deposit` | Withdrawals complete before deposits |
| `plannedAmount` | bigint | |
| `txSignature` | string? | Set when confirmed |
| `status` | `planned` \| `sent` \| `confirmed` \| `failed` | |
| `attempts` | number | Max 3 per leg (FR-022) |
| `error` | string? | |

---

## HoldState

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `dependency` \| `execution` | FR-019 |
| `reason` | string | stale_metrics, rpc_timeout, vault_unavailable, tx_failures |
| `active` | boolean | |
| `since` | datetime | |
| `acknowledgedAt` | datetime? | Required to clear execution hold |

**Resume**: dependency → auto when checks pass; execution → operator ack only.

---

## DecisionLog

Immutable audit per cycle (FR-010).

| Field | Type |
|-------|------|
| `cycleId` | uuid |
| `inputsJson` | snapshots + policy hash |
| `scoresJson` | risk + attractiveness |
| `targetsJson` | TargetAllocation[] |
| `actionsJson` | RebalanceAction summary |
| `outcome` | string |
| `rationale` | string (human-readable) |

---

## OperatorConfig (runtime)

| Field | Source |
|-------|--------|
| `solanaRpc` | `SOLANA_RPC` |
| `privateKey` | `PRIVATE_KEY` (signer) |
| `walletAddress` | derived from key |
| `vaults` | VaultConfig[3] |
| `policy` | RebalancePolicy |
| `previewMode` | `PREVIEW_MODE`; default **true** if unset (FR-008) |
| `driftTriggerEnabled` | `DRIFT_TRIGGER_ENABLED`; default false |
| `driftPollIntervalMs` | `DRIFT_POLL_INTERVAL_MS`; default 300000 (5 min) |
| `metricsMaxAgeMs` | default 15 min |
| `rpcTimeoutMs` | default 15 s |
| `cycleTimeoutMs` | default 3 min |
| `cronExpression` | default `0 * * * *` |

All validated via Zod at startup.

---

## Drizzle tables (persistence mapping)

| Table | Entity |
|-------|--------|
| `cycles` | RebalanceCycle |
| `metric_snapshots` | VaultMetricsSnapshot |
| `decision_logs` | DecisionLog |
| `rebalance_actions` | RebalanceAction |
| `hold_states` | HoldState (latest active) |
| `policy_snapshots` | RebalancePolicy hash per cycle |

Indexes: `cycles.started_at`, `metric_snapshots.vault_address + captured_at`, `hold_states.active`.
