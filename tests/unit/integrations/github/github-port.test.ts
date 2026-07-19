import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { GitHubPullRequestState } from "../../../../src/integrations/github/github-types.js";
import { createFixtureGitHubReadAdapter } from "../../../../src/integrations/github/github-port.js";

function readFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readFileSync(`tests/fixtures/github/${name}.json`, "utf8")
  ) as GitHubPullRequestState;
}

describe("GitHubPullRequestState", () => {
  it("captures the read-only PR state needed by the PR gate", () => {
    const state = readFixture("passing-pr");

    expect(state).toEqual(
      expect.objectContaining({
        repo: "octo/example",
        prNumber: 42,
        baseRef: "main",
        headSha: "abc123passing",
        changedFiles: expect.arrayContaining([
          "src/integrations/github/github-types.ts"
        ]),
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "test",
            status: "completed",
            conclusion: "success"
          })
        ]),
        reviews: expect.arrayContaining([
          expect.objectContaining({
            reviewer: "alice",
            state: "approved"
          })
        ]),
        unresolvedThreads: [],
        mergeability: expect.objectContaining({
          state: "mergeable",
          canMerge: true
        })
      })
    );
  });
});

describe("createFixtureGitHubReadAdapter", () => {
  it("returns passing, failing, pending, and unresolved-thread states by repo and PR number", async () => {
    const adapter = createFixtureGitHubReadAdapter([
      readFixture("passing-pr"),
      readFixture("failing-pr"),
      readFixture("pending-pr"),
      readFixture("unresolved-thread-pr")
    ]);

    await expect(
      adapter.readPullRequest({ repo: "octo/example", prNumber: 42 })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        state: expect.objectContaining({
          headSha: "abc123passing",
          mergeability: expect.objectContaining({ canMerge: true })
        })
      })
    );
    await expect(
      adapter.readPullRequest({ repo: "octo/example", prNumber: 43 })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        state: expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({ conclusion: "failure" })
          ])
        })
      })
    );
    await expect(
      adapter.readPullRequest({ repo: "octo/example", prNumber: 44 })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        state: expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({ status: "in_progress" })
          ])
        })
      })
    );
    await expect(
      adapter.readPullRequest({ repo: "octo/example", prNumber: 45 })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        state: expect.objectContaining({
          unresolvedThreads: expect.arrayContaining([
            expect.objectContaining({ isResolved: false })
          ])
        })
      })
    );
  });

  it("returns a typed not_found error for unknown PRs", async () => {
    const adapter = createFixtureGitHubReadAdapter([readFixture("passing-pr")]);

    await expect(
      adapter.readPullRequest({ repo: "octo/example", prNumber: 999 })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "GitHub PR state not found for octo/example#999"
      }
    });
  });
});
