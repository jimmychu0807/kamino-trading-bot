# Contract: Alerts & observability

**Version**: 1.0.0

## Alert events (structured log + optional webhook)

All alerts MUST be JSON-lines to stdout and appended to `decision_logs` / `alerts` table.

| Event | Severity | Trigger (FR) |
|-------|----------|----------------|
| `metrics_stale` | warning | FR-012 |
| `rpc_timeout` | warning | FR-021 |
| `vault_unavailable` | warning | FR-012 |
| `dependency_hold_entered` | info | FR-019 |
| `dependency_hold_cleared` | info | FR-019 |
| `execution_hold_entered` | critical | FR-019 |
| `critical_risk_exit` | critical | FR-009 |
| `cycle_timeout` | warning | FR-020 |
| `tx_leg_failed` | error | FR-022 |
| `rebalance_executed` | info | FR-007 |
| `rebalance_skipped` | info | FR-006 |

### Payload shape

```json
{
  "event": "execution_hold_entered",
  "timestamp": "2026-05-20T12:00:00.000Z",
  "cycleId": "uuid",
  "message": "human-readable",
  "details": {}
}
```

### Optional webhook

Env `ALERT_WEBHOOK_URL` — POST same JSON; failures must not block cycle completion.
