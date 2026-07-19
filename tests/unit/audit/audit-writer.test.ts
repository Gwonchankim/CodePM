import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendAuditEntry,
  createAuditEntry
} from "../../../src/audit/audit-writer.js";

describe("audit writer", () => {
  it("creates required audit fields and redacts secret-like values", () => {
    const entry = createAuditEntry({
      timestamp: "2026-05-25T13:30:00+09:00",
      actor: "codex-pm-gate",
      requestedAction: "plan_review",
      decision: "approve",
      reason: "Found token=synthetic-test-secret-token in supplied evidence.",
      filesChanged: ["README.md"],
      riskLevel: "low",
      testEvidence: "api_key=sk-live-secret123",
      github: null,
      humanApprovalRequired: false,
      humanApprovalGranted: null
    });

    expect(entry).toEqual({
      timestamp: "2026-05-25T13:30:00+09:00",
      actor: "codex-pm-gate",
      requestedAction: "plan_review",
      decision: "approve",
      reason: "Found token=[REDACTED] in supplied evidence.",
      filesChanged: ["README.md"],
      riskLevel: "low",
      testEvidence: "api_key=[REDACTED]",
      github: null,
      humanApprovalRequired: false,
      humanApprovalGranted: null
    });
  });

  it("appends audit entries as JSONL", () => {
    const dir = mkdtempSync(join(tmpdir(), "codepm-audit-"));
    const auditPath = join(dir, "audit.jsonl");
    const first = createAuditEntry({
      timestamp: "2026-05-25T13:30:00+09:00",
      actor: "codex-pm-gate",
      requestedAction: "plan_review",
      decision: "approve",
      reason: "First decision",
      filesChanged: [],
      riskLevel: "low",
      testEvidence: "Parser tests proposed.",
      github: null,
      humanApprovalRequired: false,
      humanApprovalGranted: null
    });
    const second = createAuditEntry({
      ...first,
      timestamp: "2026-05-25T13:31:00+09:00",
      decision: "request_changes",
      reason: "Second decision"
    });

    appendAuditEntry(auditPath, first);
    appendAuditEntry(auditPath, second);

    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(first);
    expect(JSON.parse(lines[1] ?? "{}")).toEqual(second);
  });
});
