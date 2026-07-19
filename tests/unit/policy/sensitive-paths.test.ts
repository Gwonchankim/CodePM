import { describe, expect, it } from "vitest";

import { findSensitivePathMatches } from "../../../src/policy/sensitive-paths.js";

describe("findSensitivePathMatches", () => {
  it("keeps built-in sensitive path rules", () => {
    const matches = findSensitivePathMatches([
      ".env.production",
      "src/review/diff-reviewer.ts"
    ]);

    expect(matches).toContainEqual(
      expect.objectContaining({
        path: ".env.production",
        reason: "environment or secret-bearing file"
      })
    );
  });

  it("matches configured literal, single-segment wildcard, and multi-segment wildcard paths", () => {
    const matches = findSensitivePathMatches(
      [
        "ops/production.json",
        "infra/us-east/prod/settings.yml",
        "secrets/team/api.json",
        "src/review/diff-reviewer.ts"
      ],
      {
        additionalSensitivePaths: [
          "ops/production.json",
          "infra/*/prod/**",
          "secrets/**"
        ]
      }
    );

    expect(matches).toEqual(
      expect.arrayContaining([
        {
          path: "ops/production.json",
          reason: "project configured sensitive path"
        },
        {
          path: "infra/us-east/prod/settings.yml",
          reason: "project configured sensitive path"
        },
        {
          path: "secrets/team/api.json",
          reason: "project configured sensitive path"
        }
      ])
    );
    expect(matches).not.toContainEqual(
      expect.objectContaining({
        path: "src/review/diff-reviewer.ts"
      })
    );
  });

  it("normalizes Windows paths before matching configured patterns", () => {
    const matches = findSensitivePathMatches(["infra\\prod\\app.yml"], {
      additionalSensitivePaths: ["infra/prod/**"]
    });

    expect(matches).toContainEqual({
      path: "infra/prod/app.yml",
      reason: "project configured sensitive path"
    });
  });
});
