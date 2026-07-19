import { describe, expect, it } from "vitest";

import { classifyRisk } from "../../../src/policy/risk-classifier.js";
import type { Proposal } from "../../../src/domain/types.js";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    goal: "Update project documentation",
    context: "The project needs clearer local setup notes.",
    proposedChanges: "Add README content and example fixtures.",
    filesExpectedToChange: ["README.md", "docs/usage.md"],
    riskAssessment: {
      level: "low",
      areas: ["documentation"]
    },
    testPlan: "Review the rendered Markdown.",
    commandsToRun: [],
    requestedAction: "plan_review",
    rollbackPlan: "Revert the documentation changes.",
    openQuestions: [],
    ...overrides
  };
}

describe("classifyRisk", () => {
  it("classifies documentation and fixture-only work as low risk", () => {
    const result = classifyRisk(makeProposal());

    expect(result.level).toBe("low");
    expect(result.reasons).toContain("Proposal declares low risk");
    expect(result.matchedRules.map((rule) => rule.id)).toContain("declared-risk");
  });

  it("classifies dependency, API, UI flow, and test infrastructure changes as medium risk", () => {
    const result = classifyRisk(
      makeProposal({
        goal: "Add a settings API and UI flow",
        proposedChanges:
          "Add an API endpoint, update request and response handling, add a UI flow, and upgrade a dependency.",
        filesExpectedToChange: [
          "src/api/settings.ts",
          "src/ui/settings-page.tsx",
          "package.json",
          "vitest.config.ts"
        ],
        riskAssessment: {
          level: "low",
          areas: ["api", "user-facing UI", "dependency", "test infrastructure"]
        },
        commandsToRun: ["npm install", "npm test"]
      })
    );

    expect(result.level).toBe("medium");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "API request or response behavior may change",
        "User-facing UI flow may change",
        "Dependency or package metadata may change",
        "Test infrastructure may change"
      ])
    );
  });

  it("classifies auth, billing, database, secrets, CI/CD, production, force push, and destructive git as high risk", () => {
    const result = classifyRisk(
      makeProposal({
        goal: "Change auth and billing database behavior",
        proposedChanges:
          "Update OAuth authorization, payment billing, database migration, production deploy workflow, and rotate API secret token.",
        filesExpectedToChange: [
          "src/auth/session.ts",
          "src/billing/payment.ts",
          "migrations/001_drop_users.sql",
          ".github/workflows/deploy.yml",
          ".env.production"
        ],
        riskAssessment: {
          level: "medium",
          areas: [
            "auth/security",
            "billing/payment",
            "database",
            "CI/deployment",
            "secrets"
          ]
        },
        commandsToRun: ["git push --force", "git reset --hard HEAD~1"]
      })
    );

    expect(result.level).toBe("high");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Authentication or authorization may change",
        "Payment or billing behavior may change",
        "Database schema or data operations may change",
        "Secrets or environment files may change",
        "CI/CD or deployment configuration may change",
        "Production configuration or deploy behavior may change",
        "Force push or destructive git command requested"
      ])
    );
  });

  it("returns matched rule metadata for PM explanations", () => {
    const result = classifyRisk(
      makeProposal({
        proposedChanges: "Add a public API breaking change.",
        filesExpectedToChange: ["src/api/public-contract.ts"]
      })
    );

    expect(result.level).toBe("high");
    expect(result.matchedRules).toContainEqual(
      expect.objectContaining({
        id: "public-api-breaking-change",
        level: "high",
        reason: "Public API breaking change may occur"
      })
    );
  });
});
