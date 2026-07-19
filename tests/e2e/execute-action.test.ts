import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Decision, Proposal, RiskLevel } from "../../src/domain/types.js";
import { runCli, runCliAsync } from "../../src/cli/index.js";
import type { GitHubPullRequestState } from "../../src/integrations/github/github-types.js";
import { formatDecisionJson } from "../../src/review/decision-formatter.js";

const tempDirs: string[] = [];
const workspaceTempRoot = join(process.cwd(), ".tmp-codepm-tests");
const githubTokenEnvName = "CODEPM_EXECUTE_ACTION_GITHUB_TOKEN";
const githubToken = "synthetic-execute-action-token";
const apiBaseUrl = "https://api.github.test";

const approvedDecision: Decision = {
  decision: "approve",
  summary: "The requested action is approved.",
  requiredChanges: [],
  risks: [],
  verificationRequired: ["Re-check state before execution."],
  approvedActions: ["Proceed to execution preflight."],
  blockedActions: ["Do not execute if state changes."]
};

function makeTempDir(prefix: string): string {
  mkdirSync(workspaceTempRoot, { recursive: true });
  const dir = mkdtempSync(join(workspaceTempRoot, prefix));
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

function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

function writeDecision(
  dir: string,
  decision: Decision = approvedDecision
): string {
  const path = join(dir, "decision.json");
  writeFileSync(path, formatDecisionJson(decision), "utf8");
  return path;
}

function writeCodePmConfig(
  dir: string,
  overrides: Record<string, unknown> = {}
): string {
  return writeJson(dir, "codepm.config.json", {
    schemaVersion: "codepm.config.v1",
    defaults: {
      baseRef: "main",
      auditLogPath: ".codepm/audit.jsonl"
    },
    review: {
      maxChangedFiles: 12,
      additionalSensitivePaths: []
    },
    github: {
      adapterMode: "fixture"
    },
    safety: {
      secretScanning: true,
      highRiskHumanApproval: true
    },
    ...overrides
  });
}

function makeProposal(action: "create_pr" | "merge_pr"): Proposal {
  return {
    goal: "Add CodePM execute-action CLI",
    context: "CodePM needs a guarded execution CLI.",
    proposedChanges: "Wire preflight to execution adapters.",
    filesExpectedToChange: [
      "src/cli/commands/execute-action.ts",
      "src/cli/index.ts"
    ],
    riskAssessment: { level: "medium", areas: ["execution"] },
    testPlan: "npm test -- --run tests/e2e/execute-action",
    commandsToRun: ["npm test -- --run tests/e2e/execute-action"],
    requestedAction: action,
    rollbackPlan: "Revert the execute-action CLI changes.",
    openQuestions: []
  };
}

function writeProposal(dir: string, proposal: Proposal): string {
  const path = join(dir, `${proposal.requestedAction}.md`);
  writeFileSync(
    path,
    [
      "# Claude Work Proposal",
      "",
      "## Goal",
      "",
      proposal.goal,
      "",
      "## Context",
      "",
      proposal.context,
      "",
      "## Proposed Changes",
      "",
      proposal.proposedChanges,
      "",
      "## Files Expected To Change",
      "",
      ...proposal.filesExpectedToChange.map((file) => `- \`${file}\``),
      "",
      "## Risk Assessment",
      "",
      `- Risk Level: ${proposal.riskAssessment.level}`,
      "- Risk Areas:",
      ...proposal.riskAssessment.areas.map((area) => `  - ${area}`),
      "",
      "## Test Plan",
      "",
      proposal.testPlan,
      "",
      "## Commands To Run",
      "",
      "```bash",
      ...proposal.commandsToRun,
      "```",
      "",
      "## Requested Action",
      "",
      proposal.requestedAction,
      "",
      "## Rollback Plan",
      "",
      proposal.rollbackPlan,
      "",
      "## Open Questions",
      "",
      "- None."
    ].join("\n"),
    "utf8"
  );
  return path;
}

function setupPushRepo(content = "changed safely\n"): {
  root: string;
  repo: string;
  remote: string;
  decisionPath: string;
  scopePath: string;
  headSha: string;
} {
  const root = makeTempDir("execute-push-");
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(root, ["init", "--bare", remote]);
  initRepo(repo);
  writeFileSync(join(repo, "README.md"), "initial\n", "utf8");
  commitAll(repo, "initial commit");
  writeFileSync(join(repo, "README.md"), `initial\n${content}`, "utf8");
  commitAll(repo, "planned change");
  git(repo, ["remote", "add", "origin", remote]);
  const headSha = git(repo, ["rev-parse", "HEAD"]).trim();
  const decisionPath = writeDecision(root);
  const scopePath = writeJson(root, "scope.json", {
    remote: "origin",
    branch: "main",
    expectedHeadSha: headSha,
    filesChanged: ["README.md"]
  });
  return { root, repo, remote, decisionPath, scopePath, headSha };
}

afterEach(() => {
  delete process.env[githubTokenEnvName];
  vi.useRealTimers();
  vi.unstubAllGlobals();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("codepm execute-action", () => {
  it("blocks missing action, decision, or risk with actionable usage", () => {
    const output = vi.fn();

    const exitCode = runCli(["execute-action"], output);

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Missing required execute-action options"
    );
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Usage: codepm execute-action"
    );
  });

  it("blocks non-approved decisions before execution", () => {
    const { repo, decisionPath, scopePath } = setupPushRepo();
    writeFileSync(
      decisionPath,
      formatDecisionJson({
        ...approvedDecision,
        decision: "request_changes",
        summary: "Needs changes."
      }),
      "utf8"
    );
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("decision_not_approved");
  });

  it("executes real push_branch against a bare repository after preflight allow", () => {
    const { repo, remote, decisionPath, scopePath, headSha } = setupPushRepo();
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1"
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("# CodePM Execution Result");
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Execution Status: pushed");
    expect(git(remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(headSha);
  });

  it("loads config from push_branch cwd and writes default audit log", () => {
    const { repo, remote, decisionPath, scopePath, headSha } = setupPushRepo();
    writeCodePmConfig(repo, {
      defaults: {
        baseRef: "main",
        auditLogPath: ".codepm/custom-audit.jsonl"
      }
    });
    commitAll(repo, "add codepm config");
    const newHeadSha = git(repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(
      scopePath,
      JSON.stringify(
        {
          remote: "origin",
          branch: "main",
          expectedHeadSha: newHeadSha,
          filesChanged: ["codepm.config.json"]
        },
        null,
        2
      ),
      "utf8"
    );
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1"
      ],
      output
    );

    const auditPath = join(repo, ".codepm", "custom-audit.jsonl");
    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(auditPath);
    expect(git(remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(
      newHeadSha
    );
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(headSha).not.toBe(newHeadSha);
  });

  it("blocks push when secret scan finds a token-like value", () => {
    const { repo, decisionPath, scopePath } = setupPushRepo(
      "token=synthetic-test-secret-token\n"
    );
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1"
      ],
      output
    );

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("secret_findings");
    expect(text).not.toContain("synthetic-test-secret-token");
  });

  it("blocks force push without exact force approval", () => {
    const { repo, decisionPath, scopePath } = setupPushRepo();
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1",
        "--force"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "force_push_not_approved"
    );
  });

  it("runs create_pr through fixture GitHub mutation result and writes audit", () => {
    const dir = makeTempDir("execute-create-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    const auditPath = join(dir, "audit.jsonl");
    writeFileSync(
      bodyPath,
      [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
        "\n\n"
      ),
      "utf8"
    );
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing",
        "--github-result",
        "tests/fixtures/github/create-pr-result.json",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Execution Status: created");
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(JSON.parse(auditLines[2] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "create_pr",
        decision: "approve",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/77",
          result: "created"
        })
      })
    );
  });

  it("uses config default audit path for create_pr fixture execution", () => {
    const dir = makeTempDir("execute-create-config-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    const configPath = writeCodePmConfig(dir, {
      defaults: {
        baseRef: "main",
        auditLogPath: "logs/create-audit.jsonl"
      }
    });
    writeFileSync(
      bodyPath,
      [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
        "\n\n"
      ),
      "utf8"
    );
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--config",
        configPath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing",
        "--github-result",
        "tests/fixtures/github/create-pr-result.json"
      ],
      output
    );

    const auditPath = join(dir, "logs", "create-audit.jsonl");
    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(auditPath);
    expect(readFileSync(auditPath, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("lets explicit audit log override the config default", () => {
    const dir = makeTempDir("execute-audit-override-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    const configPath = writeCodePmConfig(dir, {
      defaults: {
        baseRef: "main",
        auditLogPath: "logs/default-audit.jsonl"
      }
    });
    const auditPath = join(dir, "override-audit.jsonl");
    writeFileSync(
      bodyPath,
      [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
        "\n\n"
      ),
      "utf8"
    );
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--config",
        configPath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing",
        "--github-result",
        "tests/fixtures/github/create-pr-result.json",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(auditPath);
    expect(readFileSync(auditPath, "utf8").trim().split("\n")).toHaveLength(3);
    expect(() => readFileSync(join(dir, "logs", "default-audit.jsonl"), "utf8"))
      .toThrow();
  });

  it("requires a GitHub result fixture in fixture adapter mode", () => {
    const dir = makeTempDir("execute-create-missing-fixture-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    const configPath = writeCodePmConfig(dir);
    writeFileSync(bodyPath, proposal.proposedChanges, "utf8");
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--config",
        configPath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing"
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "fixture adapter mode requires --github-result"
    );
  });

  it("rejects GitHub-only mutation flags in fixture mode before fetch", () => {
    const dir = makeTempDir("execute-fixture-github-flags-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    writeFileSync(bodyPath, proposal.proposedChanges, "utf8");
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing",
        "--github-token-env",
        githubTokenEnvName
      ],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "--github-token-env can only be used with --github-mutation-adapter github"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs create_pr through explicit GitHub mutation adapter mode and writes audit", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir("execute-create-github-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    const auditPath = join(dir, "audit.jsonl");
    writeFileSync(
      bodyPath,
      [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
        "\n\n"
      ),
      "utf8"
    );
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const calls: MockFetchCall[] = [];
    vi.stubGlobal("fetch", createExecuteActionGitHubFetch(calls));
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--proposal",
        proposalPath,
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        proposal.goal,
        "--body",
        bodyPath,
        "--expected-head-sha",
        "abc123passing",
        "--github-mutation-adapter",
        "github",
        "--github-token-env",
        githubTokenEnvName,
        "--github-allowed-repo",
        "octo/example",
        "--github-api-base-url",
        apiBaseUrl,
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Execution Status: created");
    expect(text).not.toContain(githubToken);
    expect(calls.map((call) => call.url)).toEqual([
      `${apiBaseUrl}/repos/octo/example/commits/feature%2Fexecute-action`,
      `${apiBaseUrl}/repos/octo/example/pulls`
    ]);
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      })
    );
    expect(JSON.parse(calls[1]?.init?.body ?? "{}")).toEqual(
      expect.objectContaining({
        base: "main",
        head: "feature/execute-action",
        title: proposal.goal
      })
    );
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(JSON.parse(auditLines[2] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "create_pr",
        decision: "approve",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/77",
          result: "created"
        })
      })
    );
  });

  it("blocks invalid create_pr GitHub mode inputs before fetch", async () => {
    const dir = makeTempDir("execute-create-github-invalid-");
    const proposal = makeProposal("create_pr");
    const proposalPath = writeProposal(dir, proposal);
    const bodyPath = join(dir, "body.md");
    writeFileSync(
      bodyPath,
      [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
        "\n\n"
      ),
      "utf8"
    );
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      expectedHeadSha: "abc123passing",
      filesChanged: proposal.filesExpectedToChange
    });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const cases = [
      {
        name: "missing token",
        env: undefined,
        extra: ["--expected-head-sha", "abc123passing", "--github-allowed-repo", "octo/example"],
        expected: `Missing GitHub token. Set ${githubTokenEnvName}`
      },
      {
        name: "missing allowed repo",
        env: githubToken,
        extra: ["--expected-head-sha", "abc123passing"],
        expected: "requires at least one --github-allowed-repo"
      },
      {
        name: "disallowed repo",
        env: githubToken,
        extra: [
          "--expected-head-sha",
          "abc123passing",
          "--github-allowed-repo",
          "octo/other"
        ],
        expected: "is not in --github-allowed-repo"
      },
      {
        name: "missing expected head",
        env: githubToken,
        extra: ["--github-allowed-repo", "octo/example"],
        expected: "requires --expected-head-sha"
      },
      {
        name: "fixture result forbidden",
        env: githubToken,
        extra: [
          "--expected-head-sha",
          "abc123passing",
          "--github-allowed-repo",
          "octo/example",
          "--github-result",
          "tests/fixtures/github/create-pr-result.json"
        ],
        expected: "--github-result cannot be used with --github-mutation-adapter github"
      }
    ];

    for (const testCase of cases) {
      if (testCase.env) {
        process.env[githubTokenEnvName] = testCase.env;
      } else {
        delete process.env[githubTokenEnvName];
      }

      const output = vi.fn();
      const exitCode = await runCliAsync(
        [
          "execute-action",
          "--action",
          "create_pr",
          "--decision",
          decisionPath,
          "--risk",
          "low",
          "--scope",
          scopePath,
          "--proposal",
          proposalPath,
          "--repo",
          "octo/example",
          "--base-ref",
          "main",
          "--head-ref",
          "feature/execute-action",
          "--title",
          proposal.goal,
          "--body",
          bodyPath,
          "--github-mutation-adapter",
          "github",
          "--github-token-env",
          githubTokenEnvName,
          "--github-api-base-url",
          apiBaseUrl,
          ...testCase.extra
        ],
        output
      );

      expect(exitCode, testCase.name).toBe(1);
      expect(output.mock.calls[0]?.[0] ?? "", testCase.name).toContain(
        testCase.expected
      );
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks invalid config before reading action fixtures", () => {
    const dir = makeTempDir("execute-invalid-config-");
    const configPath = writeCodePmConfig(dir, {
      github: {
        adapterMode: "real-network"
      }
    });
    const decisionPath = writeDecision(dir);
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/execute-action",
      filesChanged: ["src/cli/commands/execute-action.ts"]
    });
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "create_pr",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--config",
        configPath,
        "--proposal",
        join(dir, "missing-proposal.md"),
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/execute-action",
        "--title",
        "Missing fixture should not be read",
        "--body",
        join(dir, "missing-body.md"),
        "--expected-head-sha",
        "abc123passing",
        "--github-result",
        join(dir, "missing-github-result.json")
      ],
      output
    );

    const text = output.mock.calls[0]?.[0] ?? "";
    expect(exitCode).toBe(1);
    expect(text).toContain(`Invalid CodePM config at ${configPath}`);
    expect(text).toContain("github.adapterMode");
    expect(text).not.toContain("Unable to read proposal file");
    expect(text).not.toContain("Invalid GitHub mutation result fixture");
  });

  it("runs merge_pr through fixture PR state and mutation result and writes audit", () => {
    const dir = makeTempDir("execute-merge-");
    const auditPath = join(dir, "audit.jsonl");
    const decisionPath = writeDecision(dir);
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "merge_pr",
        "--decision",
        decisionPath,
        "--risk",
        "medium",
        "--approval",
        "tests/fixtures/approvals/merge-pr-approval.json",
        "--proposal",
        "tests/fixtures/proposals/merge-pr-plan.md",
        "--state",
        "tests/fixtures/github/passing-pr.json",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--github-result",
        "tests/fixtures/github/merge-pr-result.json",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Execution Status: merged");
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(JSON.parse(auditLines[2] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/42",
          result: "merged",
          mergeSha: "merge-sha-123"
        })
      })
    );
  });

  it("runs merge_pr through explicit GitHub mutation adapter with fresh PR re-read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:10:00.000Z"));
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir("execute-merge-github-");
    const auditPath = join(dir, "audit.jsonl");
    const decisionPath = writeDecision(dir);
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      createExecuteActionGitHubFetch(calls, {
        readStates: [
          readGithubStateFixture("passing-pr"),
          readGithubStateFixture("passing-pr")
        ]
      })
    );
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "execute-action",
        "--action",
        "merge_pr",
        "--decision",
        decisionPath,
        "--risk",
        "medium",
        "--approval",
        "tests/fixtures/approvals/merge-pr-approval.json",
        "--proposal",
        "tests/fixtures/proposals/merge-pr-plan.md",
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--github-mutation-adapter",
        "github",
        "--github-token-env",
        githubTokenEnvName,
        "--github-allowed-repo",
        "octo/example",
        "--github-api-base-url",
        apiBaseUrl,
        "--merge-method",
        "squash",
        "--audit-log",
        auditPath
      ],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Execution Status: merged");
    expect(calls.filter((call) => call.url === `${apiBaseUrl}/repos/octo/example/pulls/42`)).toHaveLength(2);
    const mergeCall = calls.find(
      (call) => call.url === `${apiBaseUrl}/repos/octo/example/pulls/42/merge`
    );
    expect(mergeCall?.init?.method).toBe("PUT");
    expect(JSON.parse(mergeCall?.init?.body ?? "{}")).toEqual({
      sha: "abc123passing",
      merge_method: "squash"
    });
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(JSON.parse(auditLines[2] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/42",
          result: "merged",
          mergeSha: "merge-sha-123"
        })
      })
    );
  });

  it("blocks invalid merge_pr GitHub mode inputs before fetch", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir("execute-merge-github-invalid-");
    const decisionPath = writeDecision(dir);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const baseArgs = [
      "execute-action",
      "--action",
      "merge_pr",
      "--decision",
      decisionPath,
      "--risk",
      "medium",
      "--proposal",
      "tests/fixtures/proposals/merge-pr-plan.md",
      "--repo",
      "octo/example",
      "--pr",
      "42",
      "--expected-head-sha",
      "abc123passing",
      "--github-mutation-adapter",
      "github",
      "--github-token-env",
      githubTokenEnvName,
      "--github-api-base-url",
      apiBaseUrl
    ];
    const cases = [
      {
        name: "missing approval",
        args: [...baseArgs, "--required-check", "test", "--github-allowed-repo", "octo/example"],
        expected: "requires --approval"
      },
      {
        name: "missing required check",
        args: [
          ...baseArgs,
          "--approval",
          "tests/fixtures/approvals/merge-pr-approval.json",
          "--github-allowed-repo",
          "octo/example"
        ],
        expected: "requires at least one --required-check"
      },
      {
        name: "state forbidden",
        args: [
          ...baseArgs,
          "--approval",
          "tests/fixtures/approvals/merge-pr-approval.json",
          "--required-check",
          "test",
          "--github-allowed-repo",
          "octo/example",
          "--state",
          "tests/fixtures/github/passing-pr.json"
        ],
        expected: "--state cannot be used with --github-mutation-adapter github"
      },
      {
        name: "fixture result forbidden",
        args: [
          ...baseArgs,
          "--approval",
          "tests/fixtures/approvals/merge-pr-approval.json",
          "--required-check",
          "test",
          "--github-allowed-repo",
          "octo/example",
          "--github-result",
          "tests/fixtures/github/merge-pr-result.json"
        ],
        expected: "--github-result cannot be used with --github-mutation-adapter github"
      }
    ];

    for (const testCase of cases) {
      const output = vi.fn();
      const exitCode = await runCliAsync(testCase.args, output);

      expect(exitCode, testCase.name).toBe(1);
      expect(output.mock.calls[0]?.[0] ?? "", testCase.name).toContain(
        testCase.expected
      );
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks merge_pr GitHub mode when fresh re-read no longer satisfies the gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:10:00.000Z"));
    process.env[githubTokenEnvName] = githubToken;
    const dir = makeTempDir("execute-merge-github-stale-");
    const decisionPath = writeDecision(dir);
    const staleState = {
      ...readGithubStateFixture("passing-pr"),
      headSha: "changed-head"
    };
    const calls: MockFetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      createExecuteActionGitHubFetch(calls, {
        readStates: [readGithubStateFixture("passing-pr"), staleState]
      })
    );
    const output = vi.fn();

    const exitCode = await runCliAsync(
      [
        "execute-action",
        "--action",
        "merge_pr",
        "--decision",
        decisionPath,
        "--risk",
        "medium",
        "--approval",
        "tests/fixtures/approvals/merge-pr-approval.json",
        "--proposal",
        "tests/fixtures/proposals/merge-pr-plan.md",
        "--repo",
        "octo/example",
        "--pr",
        "42",
        "--expected-head-sha",
        "abc123passing",
        "--required-check",
        "test",
        "--github-mutation-adapter",
        "github",
        "--github-token-env",
        githubTokenEnvName,
        "--github-allowed-repo",
        "octo/example",
        "--github-api-base-url",
        apiBaseUrl
      ],
      output
    );

    const text = output.mock.calls[0]?.[0] ?? "";
    expect(exitCode).toBe(1);
    expect(text).toContain("Execution Status: blocked");
    expect(text).toContain("PR head SHA changed from abc123passing to changed-head.");
    expect(
      calls.some((call) => call.url === `${apiBaseUrl}/repos/octo/example/pulls/42/merge`)
    ).toBe(false);
  });

  it("blocks merge when PR fixture no longer satisfies the PR gate", () => {
    const dir = makeTempDir("execute-merge-block-");
    const configPath = writeCodePmConfig(dir);
    const decisionPath = writeDecision(dir);
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "merge_pr",
        "--decision",
        decisionPath,
        "--risk",
        "medium",
        "--config",
        configPath,
        "--approval",
        "tests/fixtures/approvals/merge-pr-approval.json",
        "--proposal",
        "tests/fixtures/proposals/merge-pr-plan.md",
        "--state",
        "tests/fixtures/github/failing-pr.json",
        "--expected-head-sha",
        "abc123failing",
        "--required-check",
        "test",
        "--github-result",
        "tests/fixtures/github/merge-pr-result.json"
      ],
      output
    );

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Execution Status: blocked");
    expect(text).toContain("pr_gate_blocked");
  });

  it("prints structured JSON output", () => {
    const { repo, decisionPath, scopePath } = setupPushRepo();
    const output = vi.fn();

    const exitCode = runCli(
      [
        "execute-action",
        "--action",
        "push_branch",
        "--decision",
        decisionPath,
        "--risk",
        "low",
        "--scope",
        scopePath,
        "--cwd",
        repo,
        "--remote",
        "origin",
        "--branch",
        "main",
        "--base-ref",
        "HEAD~1",
        "--json"
      ],
      output
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.mock.calls[0]?.[0] ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.execution.v1",
        action: "push_branch",
        preflight: expect.objectContaining({ status: "allow" }),
        execution: expect.objectContaining({ status: "pushed" }),
        auditLogPath: join(repo, ".codepm", "audit.jsonl")
      })
    );
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

function readGithubStateFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readFileSync(`tests/fixtures/github/${name}.json`, "utf8")
  ) as GitHubPullRequestState;
}

function createExecuteActionGitHubFetch(
  calls: MockFetchCall[],
  options: {
    readStates?: GitHubPullRequestState[];
  } = {}
) {
  const readStates = [...(options.readStates ?? [readGithubStateFixture("passing-pr")])];
  let activeState = readStates[0] ?? readGithubStateFixture("passing-pr");

  return async (
    url: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ) => {
    calls.push({ url, init });

    if (url === `${apiBaseUrl}/repos/octo/example/commits/feature%2Fexecute-action`) {
      return mockResponse({ sha: "abc123passing" });
    }

    if (url === `${apiBaseUrl}/repos/octo/example/pulls`) {
      return mockResponse(
        {
          number: 77,
          html_url: "https://github.com/octo/example/pull/77",
          head: { sha: "abc123passing" }
        },
        { status: 201 }
      );
    }

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/42`) {
      activeState = readStates.shift() ?? activeState;

      return mockResponse({
        title: activeState.title,
        body: activeState.body,
        base: { ref: activeState.baseRef },
        head: { ref: activeState.headRef, sha: activeState.headSha },
        draft: activeState.mergeability.isDraft,
        mergeable: activeState.mergeability.canMerge,
        mergeable_state: activeState.mergeability.canMerge ? "clean" : "blocked"
      });
    }

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/42/files?per_page=100`) {
      return mockResponse(
        activeState.changedFiles.map((filename) => ({ filename }))
      );
    }

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/42/reviews?per_page=100`) {
      return mockResponse(
        activeState.reviews.map((review) => ({
          user: { login: review.reviewer },
          state: review.state.toUpperCase(),
          submitted_at: review.submittedAt
        }))
      );
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/commits/${activeState.headSha}/check-runs?per_page=100`
    ) {
      return mockResponse({
        check_runs: activeState.checks.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          details_url: check.detailsUrl,
          completed_at: check.completedAt
        }))
      });
    }

    if (url === `${apiBaseUrl}/repos/octo/example/commits/${activeState.headSha}/status`) {
      return mockResponse({ statuses: [] });
    }

    if (url === `${apiBaseUrl}/graphql`) {
      return mockResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: activeState.reviewThreads.map((thread) => ({
                  id: thread.id,
                  path: thread.path,
                  line: thread.line,
                  isResolved: thread.isResolved,
                  comments: { nodes: [{ bodyText: thread.summary ?? "" }] }
                }))
              }
            }
          }
        }
      });
    }

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/42/merge`) {
      return mockResponse({
        sha: "merge-sha-123",
        merged: true,
        message: "Pull Request successfully merged"
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
