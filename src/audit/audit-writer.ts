import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { AuditEntry } from "../domain/types.js";

export type CreateAuditEntryInput = AuditEntry;

export function createAuditEntry(input: CreateAuditEntryInput): AuditEntry {
  return redactAuditEntry(input);
}

export function appendAuditEntry(path: string, entry: AuditEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function redactAuditEntry(entry: AuditEntry): AuditEntry {
  return {
    ...entry,
    reason: redactSecrets(entry.reason),
    filesChanged: entry.filesChanged.map(redactSecrets),
    testEvidence: redactSecrets(entry.testEvidence),
    github: redactUnknown(entry.github) as Record<string, unknown> | null
  };
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
        isSecretKey(key) ? "[REDACTED]" : redactUnknown(nestedValue)
      ])
    );
  }

  return value;
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(password\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(ghp|github_pat|sk|pk)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function isSecretKey(key: string): boolean {
  return /(api[_-]?key|token|secret|password|credential)/i.test(key);
}
