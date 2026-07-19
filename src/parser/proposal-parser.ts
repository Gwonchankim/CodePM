import { isRequestedAction, type RequestedAction } from "../domain/actions.js";
import type { Proposal, RiskAssessment, RiskLevel } from "../domain/types.js";
import { getSingleSection, parseMarkdownSections } from "./markdown-sections.js";

const REQUIRED_SECTIONS = [
  "Goal",
  "Context",
  "Proposed Changes",
  "Files Expected To Change",
  "Risk Assessment",
  "Test Plan",
  "Commands To Run",
  "Requested Action",
  "Rollback Plan",
  "Open Questions"
] as const;

export type ProposalSection = (typeof REQUIRED_SECTIONS)[number];

export type ProposalParseErrorCode =
  | "missing_required_section"
  | "duplicate_section"
  | "invalid_requested_action"
  | "invalid_risk_level";

export interface ProposalParseError {
  code: ProposalParseErrorCode;
  section: string;
  message: string;
}

export type ProposalParseResult =
  | {
      ok: true;
      proposal: Proposal;
      extraSections: Record<string, string>;
    }
  | {
      ok: false;
      errors: ProposalParseError[];
    };

export function parseProposalMarkdown(markdown: string): ProposalParseResult {
  const { sections } = parseMarkdownSections(markdown);
  const errors = validateRequiredSections(sections);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const requestedAction = parseRequestedAction(
    getSingleSection(sections, "Requested Action") ?? ""
  );
  if (!requestedAction) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_requested_action",
          section: "Requested Action",
          message: "Invalid requested action"
        }
      ]
    };
  }

  const riskAssessment = parseRiskAssessment(
    getSingleSection(sections, "Risk Assessment") ?? ""
  );
  if (!riskAssessment) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_risk_level",
          section: "Risk Assessment",
          message: "Invalid or missing risk level"
        }
      ]
    };
  }

  return {
    ok: true,
    proposal: {
      goal: getSingleSection(sections, "Goal") ?? "",
      context: getSingleSection(sections, "Context") ?? "",
      proposedChanges: getSingleSection(sections, "Proposed Changes") ?? "",
      filesExpectedToChange: parseList(
        getSingleSection(sections, "Files Expected To Change") ?? ""
      ),
      riskAssessment,
      testPlan: getSingleSection(sections, "Test Plan") ?? "",
      commandsToRun: parseCommands(getSingleSection(sections, "Commands To Run") ?? ""),
      requestedAction,
      rollbackPlan: getSingleSection(sections, "Rollback Plan") ?? "",
      openQuestions: parseList(getSingleSection(sections, "Open Questions") ?? "")
    },
    extraSections: getExtraSections(sections)
  };
}

function validateRequiredSections(
  sections: Map<string, string[]>
): ProposalParseError[] {
  const errors: ProposalParseError[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const values = sections.get(section);
    if (!values) {
      errors.push({
        code: "missing_required_section",
        section,
        message: `Missing required section: ${section}`
      });
      continue;
    }

    if (values.length > 1) {
      errors.push({
        code: "duplicate_section",
        section,
        message: `Duplicate section: ${section}`
      });
    }
  }

  return errors;
}

function getExtraSections(sections: Map<string, string[]>): Record<string, string> {
  const required = new Set<string>(REQUIRED_SECTIONS);
  const extraSections: Record<string, string> = {};

  for (const [heading, values] of sections.entries()) {
    if (!required.has(heading)) {
      extraSections[heading] = values.join("\n\n").trim();
    }
  }

  return extraSections;
}

function parseList(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => stripInlineCode(line.slice(2).trim()))
    .filter(Boolean);
}

function parseCommands(markdown: string): string[] {
  const fencedBlocks = [...markdown.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g)];
  const commandSource =
    fencedBlocks.length > 0
      ? fencedBlocks.map((match) => match[1] ?? "").join("\n")
      : markdown;

  return commandSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRequestedAction(markdown: string): RequestedAction | null {
  const value = stripInlineCode(
    markdown
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^-+\s*/, "") ?? ""
  );

  return isRequestedAction(value) ? value : null;
}

function parseRiskAssessment(markdown: string): RiskAssessment | null {
  const levelMatch = markdown.match(/Risk Level:\s*(low|medium|high)/i);
  const level = levelMatch?.[1]?.toLowerCase() as RiskLevel | undefined;

  if (!level) {
    return null;
  }

  const areas = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => stripInlineCode(line.slice(2).trim()))
    .filter(
      (line) =>
        line.length > 0 &&
        !line.toLowerCase().startsWith("risk level:") &&
        !line.toLowerCase().startsWith("risk areas:")
    );

  return { level, areas };
}

function stripInlineCode(value: string): string {
  return value.replace(/^`(.+)`$/, "$1").trim();
}
