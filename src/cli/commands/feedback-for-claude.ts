import { readFileSync } from "node:fs";

import { isDecision } from "../../domain/decision.js";
import type { Decision } from "../../domain/types.js";
import { formatClaudeFeedback } from "../../review/claude-feedback-formatter.js";

export interface FeedbackForClaudeCommandResult {
  exitCode: number;
  output: string;
}

interface FeedbackForClaudeOptions {
  decisionPath?: string;
}

export function runFeedbackForClaudeCommand(
  args: string[]
): FeedbackForClaudeCommandResult {
  const options = parseFeedbackForClaudeOptions(args);

  if (!options.decisionPath) {
    return {
      exitCode: 1,
      output:
        "Missing decision path.\n\nUsage: codepm feedback-for-claude --decision <decision.json>"
    };
  }

  const parsed = parseDecisionFile(options.decisionPath);

  if (!parsed.ok) {
    return {
      exitCode: 1,
      output: `Invalid decision JSON. ${parsed.error}`
    };
  }

  return {
    exitCode: 0,
    output: formatClaudeFeedback(parsed.decision)
  };
}

function parseFeedbackForClaudeOptions(args: string[]): FeedbackForClaudeOptions {
  const options: FeedbackForClaudeOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--decision") {
      options.decisionPath = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function parseDecisionFile(
  path: string
): { ok: true; decision: Decision } | { ok: false; error: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseDecisionJson(value);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read file."
    };
  }
}

function parseDecisionJson(
  value: unknown
): { ok: true; decision: Decision } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected an object." };
  }

  if (value.schemaVersion !== "codepm.decision.v1") {
    return {
      ok: false,
      error: "Expected schemaVersion codepm.decision.v1."
    };
  }

  if (!isDecisionPayload(value.decision)) {
    return {
      ok: false,
      error: "Expected a valid decision payload."
    };
  }

  return {
    ok: true,
    decision: value.decision
  };
}

function isDecisionPayload(value: unknown): value is Decision {
  if (!isRecord(value) || !isDecision(value.decision)) {
    return false;
  }

  return (
    typeof value.summary === "string" &&
    isStringArray(value.requiredChanges) &&
    isStringArray(value.risks) &&
    isStringArray(value.verificationRequired) &&
    isStringArray(value.approvedActions) &&
    isStringArray(value.blockedActions)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
