import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Proposal } from "../../../src/domain/types.js";
import { parseProposalMarkdown } from "../../../src/parser/proposal-parser.js";
import { reviewPlan } from "../../../src/review/plan-reviewer.js";

function readFixture(path: string): string {
  return readFileSync(path, "utf8");
}

function validProposal(): Proposal {
  const result = parseProposalMarkdown(readFixture("tests/fixtures/proposals/valid-plan.md"));
  if (!result.ok) {
    throw new Error("Expected valid proposal fixture to parse");
  }

  return result.proposal;
}

describe("reviewPlan", () => {
  it("approves a complete low-risk plan", () => {
    const decision = reviewPlan({ proposal: validProposal() });

    expect(decision.decision).toBe("approve");
    expect(decision.summary).toContain("complete");
    expect(decision.approvedActions).toContain("Proceed with implementation.");
    expect(decision.blockedActions).toContain(
      "Do not push, create a PR, or merge from this plan alone."
    );
  });

  it("requests changes when proposal parsing found missing required sections", () => {
    const parseResult = parseProposalMarkdown(
      readFixture("tests/fixtures/proposals/missing-test-plan.md")
    );

    const decision = reviewPlan({ parseResult });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain("Add the required section: Test Plan.");
    expect(decision.approvedActions).toContain("Revise the Claude Work Proposal.");
  });

  it("requests changes for weak test plans", () => {
    const decision = reviewPlan({
      proposal: {
        ...validProposal(),
        testPlan: "TBD"
      }
    });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain(
      "Replace the weak test plan with concrete automated or manual verification steps."
    );
  });

  it("requests changes when declared risk is understated", () => {
    const decision = reviewPlan({
      proposal: {
        ...validProposal(),
        proposedChanges: "Add a settings API endpoint and update the UI flow.",
        filesExpectedToChange: ["src/api/settings.ts", "src/ui/settings-page.tsx"],
        riskAssessment: {
          level: "low",
          areas: ["local tooling"]
        }
      }
    });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain(
      "Update the Risk Assessment from low to medium and include the matched risk reasons."
    );
  });

  it("blocks high-risk mutation requests without approval evidence", () => {
    const decision = reviewPlan({
      proposal: {
        ...validProposal(),
        goal: "Merge auth and billing database changes",
        proposedChanges:
          "Update OAuth authorization, payment billing, database migration, production config, and deployment workflow.",
        filesExpectedToChange: [
          "src/auth/session.ts",
          "src/billing/payment.ts",
          "migrations/001_update_auth.sql",
          ".github/workflows/deploy.yml",
          ".env.production"
        ],
        riskAssessment: {
          level: "medium",
          areas: ["auth/security", "billing/payment", "database", "CI/deployment"]
        },
        requestedAction: "merge_pr"
      }
    });

    expect(decision.decision).toBe("block");
    expect(decision.requiredChanges).toContain(
      "Provide explicit human approval evidence before requesting merge_pr."
    );
    expect(decision.blockedActions).toContain("Do not merge the PR.");
  });
});
