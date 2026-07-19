# Audit Log Entry Example

```json
{
  "timestamp": "2026-05-25T02:45:00+09:00",
  "actor": "codex-pm-gate",
  "requestedAction": "plan_review",
  "decision": "approve",
  "reason": "Proposal is complete, low risk, and limited to parser fixtures and tests.",
  "filesChanged": [],
  "riskLevel": "low",
  "testEvidence": "Parser tests proposed but not yet run because this is plan review.",
  "github": null,
  "humanApprovalRequired": false,
  "humanApprovalGranted": null
}
```

Audit entries should redact secret-like values and should be append-only once implementation begins.
