import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEPM_MCP_TOOL_NAMES,
  getCodePmMcpCapabilities,
  runReviewDiffTool,
  runReviewPrFixtureTool,
  runReviewPrGitHubTool,
  runReviewProposalTool,
  toCapabilitiesToolResult,
  toReviewToolResult
} from "../../src/mcp/tools.js";
import { CODEPM_CONFIG_SCHEMA_VERSION } from "../../src/config/config-schema.js";
import type { GitHubPullRequestState } from "../../src/index.js";

const tempDirs: string[] = [];
const originalAllowedRoots = process.env.CODEPM_MCP_ALLOWED_ROOTS;
const githubTokenEnvName = "CODEPM_MCP_TEST_GITHUB_TOKEN";
const githubToken = "synthetic-mcp-test-token";
const apiBaseUrl = "https://api.github.test";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readGithubFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readText(`tests/fixtures/github/${name}.json`)
  ) as GitHubPullRequestState;
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-mcp-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function initRepo(cwd: string): void {
  git(cwd, ["init"]);
  git(cwd, ["checkout", "-b", "main"]);
  git(cwd, ["config", "user.email", "codepm@example.test"]);
  git(cwd, ["config", "user.name", "CodePM Test"]);
  git(cwd, ["config", "core.autocrlf", "false"]);
}

function commitAll(cwd: string, message: string): void {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
}

function makeProposal(filesExpectedToChange: string[] = ["README.md"]): string {
  return [
    "# Claude Work Proposal",
    "",
    "## Goal",
    "",
    "Update local implementation evidence.",
    "",
    "## Context",
    "",
    "CodePM needs to check actual local git changes before push or PR creation.",
    "",
    "## Proposed Changes",
    "",
    "- Update the expected files only.",
    "",
    "## Files Expected To Change",
    "",
    ...filesExpectedToChange.map((file) => `- \`${file}\``),
    "",
    "## Risk Assessment",
    "",
    "- Risk Level: low",
    "- Risk Areas:",
    "  - local tooling",
    "",
    "## Test Plan",
    "",
    "- Run MCP review-diff smoke tests.",
    "",
    "## Commands To Run",
    "",
    "```bash",
    "npm test -- --run tests/smoke/mcp-server.test.ts",
    "```",
    "",
    "## Requested Action",
    "",
    "implementation_review",
    "",
    "## Rollback Plan",
    "",
    "Revert the local implementation changes.",
    "",
    "## Open Questions",
    "",
    "- None."
  ].join("\n");
}

function setupRepoWithReadme(): { root: string; repo: string } {
  const root = makeTempDir();
  const repo = join(root, "repo");
  mkdirSync(repo);
  initRepo(repo);
  writeFileSync(join(repo, "README.md"), "initial\n", "utf8");
  commitAll(repo, "initial commit");
  process.env.CODEPM_MCP_ALLOWED_ROOTS = root;
  return { root, repo };
}

function writeConfig(repo: string, value: unknown): string {
  const path = join(repo, "codepm.config.json");
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

afterEach(() => {
  if (originalAllowedRoots === undefined) {
    delete process.env.CODEPM_MCP_ALLOWED_ROOTS;
  } else {
    process.env.CODEPM_MCP_ALLOWED_ROOTS = originalAllowedRoots;
  }

  delete process.env[githubTokenEnvName];
  vi.unstubAllGlobals();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("CodePM MCP server tools", () => {
  it("reviews a proposal and returns plugin structured content plus Claude feedback", () => {
    const result = runReviewProposalTool({
      proposalMarkdown: readText("tests/fixtures/proposals/valid-plan.md")
    });
    const mcpResult = toReviewToolResult(result);

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve"
      })
    );
    expect(mcpResult.structuredContent).toEqual(result);
    expect(mcpResult.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("# PM Feedback For Claude")
    });
  });

  it("approves a passing PR fixture", async () => {
    const result = await runReviewPrFixtureTool({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      prState: readGithubFixture("passing-pr"),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );
  });

  it("blocks a failing PR fixture", async () => {
    const result = await runReviewPrFixtureTool({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      prState: readGithubFixture("failing-pr"),
      expectedHeadSha: "abc123failing",
      requiredCheckNames: ["test"]
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "block",
        decision: expect.objectContaining({
          decision: "block",
          risks: expect.arrayContaining(["Required check failed: test."])
        })
      })
    );
  });

  it("reviews a live GitHub PR through the read-only MCP tool", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", createGitHubFetch(calls, readGithubFixture("passing-pr")));

    const result = await runReviewPrGitHubTool({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      repo: "octo/example",
      prNumber: 42,
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"],
      tokenEnv: githubTokenEnvName,
      apiBaseUrl
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`
      })
    );
  });

  it("blocks failing live GitHub PR state through the MCP tool", async () => {
    process.env[githubTokenEnvName] = githubToken;
    vi.stubGlobal("fetch", createGitHubFetch([], readGithubFixture("failing-pr")));

    const result = await runReviewPrGitHubTool({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      repo: "octo/example",
      prNumber: 43,
      expectedHeadSha: "abc123failing",
      requiredCheckNames: ["test"],
      tokenEnv: githubTokenEnvName,
      apiBaseUrl
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "block",
        decision: expect.objectContaining({
          risks: expect.arrayContaining(["Required check failed: test."])
        })
      })
    );
  });

  it("returns adapter_error before fetch when MCP GitHub token env is missing", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runReviewPrGitHubTool({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      repo: "octo/example",
      prNumber: 42,
      tokenEnv: githubTokenEnvName,
      apiBaseUrl
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "adapter_error",
        decision: expect.objectContaining({ decision: "block" })
      })
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports review-only capabilities", () => {
    const capabilities = getCodePmMcpCapabilities();
    const mcpResult = toCapabilitiesToolResult(capabilities);

    expect(capabilities).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.mcp.v1",
        supportsExecutionMutation: false,
        supportsLocalDiffReview: true,
        supportsRealGitHubPullRequestReview: true,
        plugin: expect.objectContaining({
          schemaVersion: "codepm.plugin.v1",
          supportsRealGitHubPullRequestReview: true,
          supportsExecutionMutation: false
        }),
        safety: expect.objectContaining({
          reviewOnly: true,
          exposesExternalGitHubRead: true,
          exposesBrowserFallback: false,
          exposesGitPush: false,
          exposesGitHubMutation: false,
          requiresAllowedRootsForLocalDiffReview: true
        })
      })
    );
    expect(mcpResult.structuredContent).toEqual(capabilities);
    expect(mcpResult.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining('"supportsExecutionMutation": false')
    });
  });

  it("registers exactly the review-only MCP tool surface", () => {
    expect(CODEPM_MCP_TOOL_NAMES).toEqual([
      "codepm_review_proposal",
      "codepm_review_pr_fixture",
      "codepm_review_pr_github",
      "codepm_review_diff",
      "codepm_capabilities"
    ]);

    const exposedNames = CODEPM_MCP_TOOL_NAMES.join(" ");

    expect(exposedNames).not.toMatch(/execute|push|create_pr|merge|browser/);
  });

  it("reviews local diff changes that match the proposal scope", () => {
    const { repo } = setupRepoWithReadme();
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(),
      cwd: repo
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );
  });

  it("requests changes for local diff files outside the proposal scope", () => {
    const { repo } = setupRepoWithReadme();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "unexpected.ts"), "export const x = 1;\n", "utf8");

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(),
      cwd: repo
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "request_changes",
        decision: expect.objectContaining({
          decision: "request_changes",
          requiredChanges: expect.arrayContaining([
            "Remove or justify unexpected file change: src/unexpected.ts."
          ])
        })
      })
    );
  });

  it("blocks secret-like local diff values without exposing the raw secret", () => {
    const { repo } = setupRepoWithReadme();
    const fakeToken = "synthetic-test-secret-token";
    writeFileSync(join(repo, "README.md"), `initial\ntoken=${fakeToken}\n`, "utf8");

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(),
      cwd: repo
    });

    expect(result.status).toBe("block");
    expect(result.decision.risks).toContain(
      "Secret-like value detected in README.md: token"
    );
    expect(result.feedbackMarkdown).not.toContain(fakeToken);
  });

  it("applies review.additionalSensitivePaths from config", () => {
    const { repo } = setupRepoWithReadme();
    mkdirSync(join(repo, "infra"));
    mkdirSync(join(repo, "infra", "prod"));
    writeFileSync(join(repo, "infra", "prod", "app.yml"), "initial\n", "utf8");
    writeConfig(repo, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      review: {
        additionalSensitivePaths: ["infra/prod/**"]
      }
    });
    commitAll(repo, "add prod config");
    writeFileSync(join(repo, "infra", "prod", "app.yml"), "initial\nchanged\n", "utf8");

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(["infra/prod/app.yml"]),
      cwd: repo
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "block",
        decision: expect.objectContaining({
          risks: expect.arrayContaining([
            "Sensitive path changed: infra/prod/app.yml (project configured sensitive path)"
          ])
        })
      })
    );
  });

  it("applies review.maxChangedFiles from config", () => {
    const { repo } = setupRepoWithReadme();
    writeConfig(repo, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      review: {
        maxChangedFiles: 1
      }
    });
    commitAll(repo, "add config");
    writeFileSync(join(repo, "README.md"), "initial\nchanged\n", "utf8");
    writeFileSync(join(repo, "notes.md"), "new\n", "utf8");

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(["README.md", "notes.md"]),
      cwd: repo
    });

    expect(result.status).toBe("request_changes");
    expect(result.decision.requiredChanges).toContain(
      "Reduce the diff scope or update the proposal for a broad change set: 2 files changed, limit is 1."
    );
  });

  it("returns adapter_error before git read when config is invalid", () => {
    const root = makeTempDir();
    process.env.CODEPM_MCP_ALLOWED_ROOTS = root;
    writeConfig(root, {
      schemaVersion: "codepm.config.v0"
    });

    const result = runReviewDiffTool({
      proposalMarkdown: makeProposal(),
      cwd: root
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "adapter_error",
        decision: expect.objectContaining({
          decision: "block",
          summary: expect.stringContaining("Invalid CodePM config at")
        })
      })
    );
    expect(result.feedbackMarkdown).not.toContain("git work tree");
  });

  it("blocks cwd outside CODEPM_MCP_ALLOWED_ROOTS before proposal review", () => {
    const allowedRoot = makeTempDir();
    const deniedRoot = makeTempDir();
    process.env.CODEPM_MCP_ALLOWED_ROOTS = allowedRoot;

    const result = runReviewDiffTool({
      proposalMarkdown: "not a proposal",
      cwd: deniedRoot
    });

    expect(result.status).toBe("adapter_error");
    expect(result.decision.summary).toContain(
      "MCP review-diff cwd is outside CODEPM_MCP_ALLOWED_ROOTS"
    );
    expect(result.feedbackMarkdown).not.toContain("Invalid proposal");
  });

  it("blocks configPath outside CODEPM_MCP_ALLOWED_ROOTS before proposal review", () => {
    const allowedRoot = makeTempDir();
    const deniedRoot = makeTempDir();
    process.env.CODEPM_MCP_ALLOWED_ROOTS = allowedRoot;
    const outsideConfig = writeConfig(deniedRoot, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION
    });

    const result = runReviewDiffTool({
      proposalMarkdown: "not a proposal",
      cwd: allowedRoot,
      configPath: outsideConfig
    });

    expect(result.status).toBe("adapter_error");
    expect(result.decision.summary).toContain(
      "MCP review-diff configPath is outside CODEPM_MCP_ALLOWED_ROOTS"
    );
    expect(result.feedbackMarkdown).not.toContain("Invalid proposal");
  });
});

interface FetchCall {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

function createGitHubFetch(
  calls: FetchCall[],
  state: GitHubPullRequestState
) {
  return async (
    url: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ) => {
    calls.push({ url, init });

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}`) {
      return mockResponse({
        title: state.title,
        body: state.body,
        base: { ref: state.baseRef },
        head: { ref: state.headRef, sha: state.headSha },
        draft: state.mergeability.isDraft,
        mergeable: state.mergeability.canMerge,
        mergeable_state: state.mergeability.canMerge ? "clean" : "blocked"
      });
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}/files?per_page=100`
    ) {
      return mockResponse(state.changedFiles.map((filename) => ({ filename })));
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}/reviews?per_page=100`
    ) {
      return mockResponse(
        state.reviews.map((review) => ({
          user: { login: review.reviewer },
          state: review.state.toUpperCase(),
          submitted_at: review.submittedAt
        }))
      );
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/commits/${state.headSha}/check-runs?per_page=100`
    ) {
      return mockResponse({
        check_runs: state.checks.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          details_url: check.detailsUrl,
          completed_at: check.completedAt
        }))
      });
    }

    if (
      url === `${apiBaseUrl}/repos/octo/example/commits/${state.headSha}/status`
    ) {
      return mockResponse({ statuses: [] });
    }

    if (url === `${apiBaseUrl}/graphql`) {
      return mockResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: []
              }
            }
          }
        }
      });
    }

    return mockResponse({ message: `Unexpected URL ${url}` }, { status: 500 });
  };
}

function mockResponse(
  value: unknown,
  options: { status?: number } = {}
): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
} {
  const status = options.status ?? 200;

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return null;
      }
    },
    async text() {
      return JSON.stringify(value);
    }
  };
}
