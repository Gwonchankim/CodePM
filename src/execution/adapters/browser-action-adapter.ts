import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { RiskLevel } from "../../domain/types.js";
import {
  evaluateBrowserFallbackPolicy,
  type BrowserFallbackAction,
  type BrowserFallbackApproval,
  type BrowserFallbackFinding,
  type BrowserFallbackTarget
} from "../../integrations/browser/browser-fallback-policy.js";
import { redactSecrets } from "../../policy/redaction.js";

export interface BrowserFallbackRunnerInput {
  action: BrowserFallbackAction;
  target: BrowserFallbackTarget;
}

export type BrowserFallbackRunnerResult =
  | {
      ok: true;
      observedResult: string;
      url?: string;
    }
  | {
      ok: false;
      observedResult: string;
      error: string;
      url?: string;
    };

export interface ExecuteBrowserFallbackActionInput {
  action: BrowserFallbackAction;
  target: BrowserFallbackTarget;
  sourceCommand: string;
  structuredAdapterAvailable: boolean;
  approval?: BrowserFallbackApproval;
  auditLogPath?: string;
  now?: string;
  runner(input: BrowserFallbackRunnerInput): BrowserFallbackRunnerResult;
}

export type BrowserFallbackExecutionResult =
  | {
      ok: true;
      status: "completed";
      riskLevel: RiskLevel;
      findings: [];
      observedResult: string;
      url?: string;
    }
  | {
      ok: false;
      status: "blocked";
      riskLevel: RiskLevel;
      findings: BrowserFallbackFinding[];
    }
  | {
      ok: false;
      status: "failed";
      riskLevel: RiskLevel;
      findings: BrowserFallbackFinding[];
      observedResult: string;
      url?: string;
    };

interface BrowserFallbackAuditEntry {
  schemaVersion: "codepm.browserFallbackAudit.v1";
  timestamp: string;
  actor: "codex-pm-gate";
  phase: "blocked" | "intended" | "observed";
  action: BrowserFallbackAction;
  sourceCommand: string;
  decision: "approve" | "block";
  riskLevel: RiskLevel;
  target: BrowserFallbackTarget;
  approval:
    | {
        approver: string;
        approvedAt: string;
      }
    | null;
  observedResult?: string;
  url?: string;
  findings?: BrowserFallbackFinding[];
}

export function executeBrowserFallbackAction(
  input: ExecuteBrowserFallbackActionInput
): BrowserFallbackExecutionResult {
  const policy = evaluateBrowserFallbackPolicy(input);

  if (!policy.ok) {
    appendAuditIfRequested(input, {
      phase: "blocked",
      decision: "block",
      riskLevel: policy.riskLevel,
      findings: policy.findings
    });

    return {
      ok: false,
      status: "blocked",
      riskLevel: policy.riskLevel,
      findings: policy.findings
    };
  }

  appendAuditIfRequested(input, {
    phase: "intended",
    decision: "approve",
    riskLevel: policy.riskLevel
  });

  const runnerResult = input.runner({
    action: input.action,
    target: input.target
  });

  if (!runnerResult.ok) {
    const findings = [
      {
        code: "browser_action_failed" as const,
        message: runnerResult.error
      }
    ];
    appendAuditIfRequested(input, {
      phase: "observed",
      decision: "block",
      riskLevel: policy.riskLevel,
      observedResult: runnerResult.observedResult,
      url: runnerResult.url,
      findings
    });

    return {
      ok: false,
      status: "failed",
      riskLevel: policy.riskLevel,
      findings,
      observedResult: runnerResult.observedResult,
      url: runnerResult.url
    };
  }

  appendAuditIfRequested(input, {
    phase: "observed",
    decision: "approve",
    riskLevel: policy.riskLevel,
    observedResult: runnerResult.observedResult,
    url: runnerResult.url
  });

  return {
    ok: true,
    status: "completed",
    riskLevel: policy.riskLevel,
    findings: [],
    observedResult: runnerResult.observedResult,
    url: runnerResult.url
  };
}

function appendAuditIfRequested(
  input: ExecuteBrowserFallbackActionInput,
  entry: Pick<
    BrowserFallbackAuditEntry,
    "decision" | "findings" | "observedResult" | "phase" | "riskLevel" | "url"
  >
): void {
  if (!input.auditLogPath) {
    return;
  }

  mkdirSync(dirname(input.auditLogPath), { recursive: true });
  appendFileSync(
    input.auditLogPath,
    `${JSON.stringify(redactAuditEntry(toAuditEntry(input, entry)))}\n`,
    "utf8"
  );
}

function toAuditEntry(
  input: ExecuteBrowserFallbackActionInput,
  entry: Pick<
    BrowserFallbackAuditEntry,
    "decision" | "findings" | "observedResult" | "phase" | "riskLevel" | "url"
  >
): BrowserFallbackAuditEntry {
  return {
    schemaVersion: "codepm.browserFallbackAudit.v1",
    timestamp: input.now ?? new Date().toISOString(),
    actor: "codex-pm-gate",
    phase: entry.phase,
    action: input.action,
    sourceCommand: input.sourceCommand,
    decision: entry.decision,
    riskLevel: entry.riskLevel,
    target: input.target,
    approval: input.approval
      ? {
          approver: input.approval.approver,
          approvedAt: input.approval.approvedAt
        }
      : null,
    observedResult: entry.observedResult,
    url: entry.url,
    findings: entry.findings
  };
}

function redactAuditEntry(entry: BrowserFallbackAuditEntry): BrowserFallbackAuditEntry {
  return redactUnknown(entry) as BrowserFallbackAuditEntry;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSecretKey(key) ? "***REDACTED***" : redactUnknown(nestedValue)
      ])
    );
  }

  return value;
}

function isSecretKey(key: string): boolean {
  return /(api[_-]?key|token|secret|password|credential)/i.test(key);
}
