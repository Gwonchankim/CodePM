import { isRequestedAction } from "../domain/actions.js";
import type { ActionRequest, Proposal } from "../domain/types.js";
import { parseProposalMarkdown } from "../parser/proposal-parser.js";

export type ClaudeOutputBlockKind =
  | "proposal"
  | "test_evidence"
  | "action_request";

export interface ClaudeOutputBlock {
  kind: ClaudeOutputBlockKind;
  language: string;
  content: string;
  startLine: number;
  endLine: number;
}

export type ClaudeOutputNormalizeErrorCode =
  | "missing_proposal_block"
  | "duplicate_proposal_block"
  | "duplicate_action_request_block"
  | "invalid_proposal_block"
  | "invalid_action_request";

export interface ClaudeOutputNormalizeError {
  code: ClaudeOutputNormalizeErrorCode;
  message: string;
}

export type ClaudeOutputNormalizeResult =
  | {
      ok: true;
      proposal: Proposal;
      actionRequest: ActionRequest;
      testEvidence?: string;
      blocks: ClaudeOutputBlock[];
    }
  | {
      ok: false;
      errors: ClaudeOutputNormalizeError[];
      feedbackForClaude: string;
      blocks: ClaudeOutputBlock[];
    };

interface FencedBlock {
  language: string;
  content: string;
  startLine: number;
  endLine: number;
}

const LANGUAGE_KIND: Record<string, ClaudeOutputBlockKind> = {
  "codepm-proposal": "proposal",
  "codepm-test-evidence": "test_evidence",
  "codepm-evidence": "test_evidence",
  "codepm-action-request": "action_request",
  "codepm-action": "action_request"
};

export function normalizeClaudeOutput(text: string): ClaudeOutputNormalizeResult {
  const blocks = extractCodepmBlocks(text);
  const proposalBlocks = blocks.filter((block) => block.kind === "proposal");
  const actionRequestBlocks = blocks.filter(
    (block) => block.kind === "action_request"
  );
  const errors: ClaudeOutputNormalizeError[] = [];

  if (proposalBlocks.length === 0) {
    errors.push({
      code: "missing_proposal_block",
      message: "Missing fenced codepm-proposal block."
    });
  }

  if (proposalBlocks.length > 1) {
    errors.push({
      code: "duplicate_proposal_block",
      message: "Multiple codepm-proposal blocks found; provide exactly one."
    });
  }

  if (actionRequestBlocks.length > 1) {
    errors.push({
      code: "duplicate_action_request_block",
      message: "Multiple codepm-action-request blocks found; provide exactly one."
    });
  }

  const proposalBlock = proposalBlocks[0];
  const parsedProposal = proposalBlock
    ? parseProposalMarkdown(proposalBlock.content)
    : undefined;

  if (parsedProposal && !parsedProposal.ok) {
    errors.push({
      code: "invalid_proposal_block",
      message: parsedProposal.errors.map((error) => error.message).join("; ")
    });
  }

  if (!parsedProposal?.ok || errors.length > 0) {
    return {
      ok: false,
      errors,
      feedbackForClaude: formatMissingStructureFeedback(errors),
      blocks
    };
  }

  const actionRequest = parseActionRequest(
    actionRequestBlocks[0]?.content,
    parsedProposal.proposal
  );

  if (!actionRequest) {
    const actionErrors: ClaudeOutputNormalizeError[] = [
      {
        code: "invalid_action_request",
        message: "Missing or invalid requested action in codepm-action-request block."
      }
    ];

    return {
      ok: false,
      errors: actionErrors,
      feedbackForClaude: formatMissingStructureFeedback(actionErrors),
      blocks
    };
  }

  return {
    ok: true,
    proposal: parsedProposal.proposal,
    actionRequest,
    testEvidence: blocks
      .filter((block) => block.kind === "test_evidence")
      .map((block) => block.content.trim())
      .filter(Boolean)
      .join("\n\n") || undefined,
    blocks
  };
}

function extractCodepmBlocks(text: string): ClaudeOutputBlock[] {
  return extractFencedBlocks(text).flatMap((block) => {
    const normalizedLanguage = block.language.toLowerCase();
    const kind = LANGUAGE_KIND[normalizedLanguage];

    if (!kind) {
      return [];
    }

    return [
      {
        kind,
        language: normalizedLanguage,
        content: block.content.trim(),
        startLine: block.startLine,
        endLine: block.endLine
      }
    ];
  });
}

function extractFencedBlocks(text: string): FencedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  let active:
    | {
        fenceChar: "`" | "~";
        fenceLength: number;
        language: string;
        content: string[];
        startLine: number;
      }
    | undefined;

  lines.forEach((line, index) => {
    if (!active) {
      const opener = line.match(/^(`{3,}|~{3,})([A-Za-z0-9_-]*)\s*$/);

      if (opener) {
        const fence = opener[1] ?? "";
        active = {
          fenceChar: fence.startsWith("`") ? "`" : "~",
          fenceLength: fence.length,
          language: opener[2] ?? "",
          content: [],
          startLine: index + 1
        };
      }

      return;
    }

    if (isClosingFence(line, active.fenceChar, active.fenceLength)) {
      blocks.push({
        language: active.language,
        content: active.content.join("\n"),
        startLine: active.startLine,
        endLine: index + 1
      });
      active = undefined;
      return;
    }

    active.content.push(line);
  });

  return blocks;
}

function isClosingFence(
  line: string,
  fenceChar: "`" | "~",
  fenceLength: number
): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fenceLength &&
    [...trimmed].every((char) => char === fenceChar)
  );
}

function parseActionRequest(
  content: string | undefined,
  proposal: Proposal
): ActionRequest | null {
  if (!content) {
    return {
      requestedAction: proposal.requestedAction,
      source: "proposal"
    };
  }

  const values = parseKeyValueBlock(content);
  const requestedAction =
    values.requestedaction ??
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

  if (!isRequestedAction(requestedAction)) {
    return null;
  }

  return {
    requestedAction,
    source: "claude_cli",
    repo: values.repo,
    branch: values.branch,
    prNumber: parseOptionalNumber(values.prnumber),
    expectedHeadSha: values.expectedheadsha
  };
}

function parseKeyValueBlock(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [
        (match[1] ?? "").toLowerCase().replaceAll("-", ""),
        (match[2] ?? "").trim()
      ])
  );
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function formatMissingStructureFeedback(
  errors: ClaudeOutputNormalizeError[]
): string {
  return [
    "# PM Feedback For Claude",
    "",
    "Decision: request_changes",
    "",
    "## Summary",
    "",
    "CodePM could not normalize your Claude CLI output into the required structured blocks.",
    "",
    "## Required Changes",
    "",
    ...errors.map((error) => `- ${error.message}`),
    "- Resend the proposal in this fenced block format:",
    "",
    "```codepm-proposal",
    "# Claude Work Proposal",
    "## Goal",
    "...",
    "```",
    "",
    "## Evidence To Provide Next",
    "",
    "- Include test output in a ```codepm-test-evidence fenced block when implementation evidence exists.",
    "- Include the requested next action in a ```codepm-action-request fenced block when asking for an implementation, push, PR, or merge gate.",
    "",
    "## Blocked Actions",
    "",
    "- Do not proceed until CodePM can parse the structured output."
  ].join("\n");
}
