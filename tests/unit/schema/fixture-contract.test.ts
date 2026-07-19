import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredProposalSections = [
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

const requestedActions = [
  "plan_review",
  "implementation_review",
  "push_branch",
  "create_pr",
  "merge_pr"
] as const;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function countHeading(markdown: string, heading: string): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...markdown.matchAll(new RegExp(`^## ${escaped}$`, "gm"))].length;
}

describe("schema and fixtures", () => {
  it("documents core CodePM contracts", () => {
    const schema = readText("docs/schema.md");

    expect(schema).toContain("Proposal");
    expect(schema).toContain("ActionRequest");
    expect(schema).toContain("Decision");
    expect(schema).toContain("ClaudeFeedback");
    expect(schema).toContain("AuditEntry");
  });

  it("includes a valid proposal fixture with each required section exactly once", () => {
    const proposal = readText("tests/fixtures/proposals/valid-plan.md");

    for (const section of requiredProposalSections) {
      expect(countHeading(proposal, section), section).toBe(1);
    }
  });

  it("covers every requested action with an action request fixture", () => {
    const files = readdirSync("tests/fixtures/action-requests");
    const fixtureActions = files.map((file) => {
      const raw = readText(join("tests/fixtures/action-requests", file));
      return JSON.parse(raw) as { requestedAction: string };
    });

    expect(fixtureActions.map((fixture) => fixture.requestedAction).sort()).toEqual(
      [...requestedActions].sort()
    );
  });
});
