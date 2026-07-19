import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, runCliAsync } from "../../src/cli/index.js";
import { CODEPM_CONFIG_SCHEMA_VERSION } from "../../src/config/config-schema.js";
import type {
  GitHubPullRequestState,
  GitHubReviewState
} from "../../src/integrations/github/github-types.js";

const tempDirs: string[] = [];

const proposalPath = "tests/fixtures/proposals/merge-pr-plan.md";
const passingStatePath = "tests/fixtures/github/passing-pr.json";
const failingStatePath = "tests/fixtures/github/failing-pr.json";
const apiBaseUrl = "https://api.github.test";
const configuredApiBaseUrl = "https://github.configured.test";
const githubTokenEnvName = "CODEPM_TEST_GITHUB_TOKEN";
const githubToken = "synthetic-codepm-test-token";

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-review-pr-"));
  tempDirs.push(dir);
  return dir;
}

function writeReviewPrConfig(
  cwd: string,
  github: Record<string, unknown>,
  defaults: Record<string, unknown> = {}
): string {
  const path = join(cwd, "codepm.config.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
        defaults,
        github
      },
      null,
      2
    ),
    "utf8"
  );
  return path;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }

  delete process.env[githubTokenEnvName];
  vi.unstubAllGlobals();
});

describe("codepm review-pr", () => {
  it("approves a merge-ready PR from recorded fixture state", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Gate Decision");
    expect(text).toContain("Decision: approve");
    expect(text).toContain("merge-ready");
  });

  it("supports explicit fixture adapter mode", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--adapter",
        "fixture",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Decision: approve");
  });

  it("prints structured JSON and appends GitHub audit context when requested", () => {
    const auditPath = join(makeTempDir(), "audit.jsonl");
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--json",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.mock.calls[0]?.[0] ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.decision.v1",
        decision: expect.objectContaining({
          decision: "approve"
        })
      })
    );

    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        filesChanged: [
          "src/integrations/github/github-types.ts",
          "src/integrations/github/github-port.ts"
        ],
        github: expect.objectContaining({
          repo: "octo/example",
          prNumber: 42,
          headSha: "abc123passing"
        })
      })
    );
  });

  it("prints Claude-facing feedback when requested", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--feedback-for-claude"
      ],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Feedback For Claude");
    expect(text).toContain("Decision: approve");
  });

  it("blocks a PR with failing required checks", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--state",
        failingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "43",
        "--expected-head-sha",
        "abc123failing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: block");
    expect(text).toContain("Required check failed: test.");
  });

  it("returns actionable output when no GitHub read source is configured", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "No GitHub read adapter configured"
    );
  });

  it("rejects fixture state that does not match the requested PR locator", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "99"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Fixture state does not match requested repo/pr"
    );
  });

  it("reviews a live GitHub PR through the opt-in read adapter", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const calls: MockFetchCall[] = [];
    vi.stubGlobal("fetch", createGitHubFetch(calls, readStateFixture(passingStatePath)));
    const auditPath = join(makeTempDir(), "audit.jsonl");
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--github-token-env",
        githubTokenEnvName,
        "--github-api-base-url",
        apiBaseUrl,
        "--json",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.mock.calls[0]?.[0] ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.decision.v1",
        decision: expect.objectContaining({
          decision: "approve",
          summary: expect.stringContaining("merge-ready")
        })
      })
    );
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      })
    );

    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        decision: "approve",
        github: expect.objectContaining({
          repo: "octo/example",
          prNumber: 42,
          headSha: "abc123passing"
        })
      })
    );
  });

  it("blocks a live GitHub PR with failing required checks", async () => {
    process.env[githubTokenEnvName] = githubToken;
    vi.stubGlobal("fetch", createGitHubFetch([], readStateFixture(failingStatePath)));
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "43",
        "--expected-head-sha",
        "abc123failing",
        "--required-check",
        "test",
        "--github-token-env",
        githubTokenEnvName,
        "--github-api-base-url",
        apiBaseUrl
      ],
      output
    );

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: block");
    expect(text).toContain("Required check failed: test.");
  });

  it("requires a token env before calling the GitHub adapter", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--github-token-env",
        githubTokenEnvName,
        "--github-api-base-url",
        apiBaseUrl
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      `Missing GitHub token. Set ${githubTokenEnvName}`
    );
  });

  it("rejects incompatible adapter mode flags before adapter calls", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const githubOutput = vi.fn();
    const fixtureOutput = vi.fn();

    const githubExitCode = await runCliAsync(
      [
        "review-pr",
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--github-token-env",
        githubTokenEnvName
      ],
      githubOutput
    );
    const fixtureExitCode = runCli(
      [
        "review-pr",
        "--adapter",
        "fixture",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--github-token-env",
        githubTokenEnvName
      ],
      fixtureOutput
    );

    expect(githubExitCode).toBe(1);
    expect(githubOutput.mock.calls[0]?.[0] ?? "").toContain(
      "--state cannot be used with --adapter github"
    );
    expect(fixtureExitCode).toBe(1);
    expect(fixtureOutput.mock.calls[0]?.[0] ?? "").toContain(
      "--github-token-env can only be used with --adapter github"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns GitHub adapter errors into safe block decisions", async () => {
    process.env[githubTokenEnvName] = githubToken;
    vi.stubGlobal(
      "fetch",
      async () => mockResponse({ message: githubToken }, { status: 401 })
    );
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--github-token-env",
        githubTokenEnvName,
        "--github-api-base-url",
        apiBaseUrl,
        "--feedback-for-claude"
      ],
      output
    );

    const text = output.mock.calls[0]?.[0] ?? "";
    expect(exitCode).toBe(1);
    expect(text).toContain("Decision: block");
    expect(text).toContain("GitHub PR state could not be read");
    expect(text).not.toContain(githubToken);
  });

  it("uses config to select GitHub PR read mode", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir();
    const configPath = writeReviewPrConfig(dir, {
      prReadAdapterMode: "github",
      prReadTokenEnv: githubTokenEnvName,
      prReadApiBaseUrl: configuredApiBaseUrl,
      prReadApiVersion: "2023-01-01"
    });
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      createGitHubFetch(calls, readStateFixture(passingStatePath), {
        apiBaseUrlOverride: configuredApiBaseUrl
      })
    );
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--config",
        configPath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Decision: approve");
    expect(calls[0]?.url).toBe(`${configuredApiBaseUrl}/repos/octo/example/pulls/42`);
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2023-01-01"
      })
    );
  });

  it("lets --adapter fixture override GitHub PR read config", async () => {
    const dir = makeTempDir();
    const configPath = writeReviewPrConfig(dir, {
      prReadAdapterMode: "github",
      prReadTokenEnv: githubTokenEnvName,
      prReadApiBaseUrl: configuredApiBaseUrl
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--config",
        configPath,
        "--adapter",
        "fixture",
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Decision: approve");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets --adapter github override fixture config while using config GitHub defaults", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir();
    const configPath = writeReviewPrConfig(dir, {
      prReadAdapterMode: "fixture",
      prReadTokenEnv: githubTokenEnvName,
      prReadApiBaseUrl: configuredApiBaseUrl,
      prReadApiVersion: "2023-01-01"
    });
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      createGitHubFetch(calls, readStateFixture(passingStatePath), {
        apiBaseUrlOverride: configuredApiBaseUrl
      })
    );
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--config",
        configPath,
        "--adapter",
        "github",
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2023-01-01"
      })
    );
  });

  it("rejects invalid config before reading proposal, fixture, or GitHub state", async () => {
    const dir = makeTempDir();
    const configPath = writeReviewPrConfig(dir, {
      prReadAdapterMode: "live"
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "review-pr",
        "--config",
        configPath,
        "--proposal",
        join(dir, "missing-proposal.md"),
        "--repo",
        "octo/example",
        "--pr",
        "42"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      `Invalid CodePM config at ${configPath}`
    );
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "github.prReadAdapterMode"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not use config default audit path for review-pr", () => {
    const dir = makeTempDir();
    const auditPath = join(dir, ".codepm", "audit.jsonl");
    const configPath = writeReviewPrConfig(
      dir,
      {
        prReadAdapterMode: "fixture"
      },
      {
        auditLogPath: auditPath
      }
    );
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--config",
        configPath,
        "--proposal",
        proposalPath,
        "--state",
        passingStatePath,
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(existsSync(auditPath)).toBe(false);
  });
});

interface MockFetchCall {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

function readStateFixture(path: string): GitHubPullRequestState {
  return JSON.parse(readFileSync(path, "utf8")) as GitHubPullRequestState;
}

function createGitHubFetch(
  calls: MockFetchCall[],
  state: GitHubPullRequestState,
  options: { apiBaseUrlOverride?: string } = {}
) {
  const baseUrl = options.apiBaseUrlOverride ?? apiBaseUrl;

  return async (
    url: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ) => {
    calls.push({ url, init });

    if (url === `${baseUrl}/repos/octo/example/pulls/${state.prNumber}`) {
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
      `${baseUrl}/repos/octo/example/pulls/${state.prNumber}/files?per_page=100`
    ) {
      return mockResponse(
        state.changedFiles.map((filename) => ({ filename }))
      );
    }

    if (
      url ===
      `${baseUrl}/repos/octo/example/pulls/${state.prNumber}/reviews?per_page=100`
    ) {
      return mockResponse(
        state.reviews.map((review) => ({
          user: { login: review.reviewer },
          state: toGitHubReviewState(review.state),
          submitted_at: review.submittedAt
        }))
      );
    }

    if (
      url ===
      `${baseUrl}/repos/octo/example/commits/${state.headSha}/check-runs?per_page=100`
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
      url ===
      `${baseUrl}/repos/octo/example/commits/${state.headSha}/status`
    ) {
      return mockResponse({ statuses: [] });
    }

    if (url === `${baseUrl}/graphql`) {
      return mockResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null
                },
                nodes: state.reviewThreads.map((thread) => ({
                  id: thread.id,
                  path: thread.path,
                  line: thread.line,
                  isResolved: thread.isResolved,
                  comments: {
                    nodes: thread.summary
                      ? [{ bodyText: thread.summary }]
                      : []
                  }
                }))
              }
            }
          }
        }
      });
    }

    return mockResponse({ message: `Unexpected URL ${url}` }, { status: 500 });
  };
}

function toGitHubReviewState(state: GitHubReviewState): string {
  return state.toUpperCase();
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
