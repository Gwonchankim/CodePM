import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../../src/cli/index.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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

function runInRepo(repo: string, args: string[], output = vi.fn()): number {
  process.chdir(repo);
  try {
    return runCli(args, output);
  } finally {
    process.chdir(originalCwd);
  }
}

function writeImplementationProposal(dir: string): string {
  const path = join(dir, "implementation-proposal.md");
  writeFileSync(
    path,
    [
      "# Claude Work Proposal",
      "",
      "## Goal",
      "",
      "Update the README with a local usage note.",
      "",
      "## Context",
      "",
      "Claude has implemented a small documentation-only change.",
      "",
      "## Proposed Changes",
      "",
      "- Update the expected README file.",
      "",
      "## Files Expected To Change",
      "",
      "- `README.md`",
      "",
      "## Risk Assessment",
      "",
      "- Risk Level: low",
      "- Risk Areas:",
      "  - documentation",
      "",
      "## Test Plan",
      "",
      "- Run local documentation review.",
      "",
      "## Commands To Run",
      "",
      "```bash",
      "npm test -- --run tests/e2e/review-diff",
      "```",
      "",
      "## Requested Action",
      "",
      "implementation_review",
      "",
      "## Rollback Plan",
      "",
      "Revert the README change.",
      "",
      "## Open Questions",
      "",
      "- None."
    ].join("\n"),
    "utf8"
  );
  return path;
}

function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

afterEach(() => {
  process.chdir(originalCwd);

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("Claude-Codex PM workflow", () => {
  it("turns a low-risk plan approval into Claude-facing feedback", () => {
    const dir = makeTempDir("codepm-workflow-plan-");
    const output = vi.fn();

    const reviewExitCode = runCli(
      ["review-plan", "tests/fixtures/proposals/valid-plan.md", "--json"],
      output
    );

    expect(reviewExitCode).toBe(0);
    const decisionPath = join(dir, "decision.json");
    writeFileSync(decisionPath, output.mock.calls[0]?.[0] ?? "", "utf8");

    const feedbackOutput = vi.fn();
    const feedbackExitCode = runCli(
      ["feedback-for-claude", "--decision", decisionPath],
      feedbackOutput
    );

    expect(feedbackExitCode).toBe(0);
    const feedback = feedbackOutput.mock.calls[0]?.[0] ?? "";
    expect(feedback).toContain("# PM Feedback For Claude");
    expect(feedback).toContain("Decision: approve");
    expect(feedback).toContain("- Proceed with implementation.");
  });

  it("returns Claude-facing request changes for unexpected local diff files", () => {
    const root = makeTempDir("codepm-workflow-diff-");
    const repo = join(root, "repo");
    mkdirSync(repo);
    initRepo(repo);
    writeFileSync(join(repo, "README.md"), "initial\n", "utf8");
    commitAll(repo, "initial commit");
    const proposalPath = writeImplementationProposal(root);
    mkdirSync(join(repo, "src"));
    writeFileSync(
      join(repo, "src", "unexpected.ts"),
      "export const unexpected = true;\n",
      "utf8"
    );
    const output = vi.fn();

    const exitCode = runInRepo(
      repo,
      ["review-diff", "--proposal", proposalPath, "--feedback-for-claude"],
      output
    );

    const feedback = output.mock.calls[0]?.[0] ?? "";
    expect(exitCode).toBe(1);
    expect(feedback).toContain("# PM Feedback For Claude");
    expect(feedback).toContain("Decision: request_changes");
    expect(feedback).toContain("src/unexpected.ts");
  });

  it("blocks PR merge readiness when the required check is failing", () => {
    const output = vi.fn();

    const exitCode = runCli(
      [
        "review-pr",
        "--proposal",
        "tests/fixtures/proposals/merge-pr-plan.md",
        "--state",
        "tests/fixtures/github/failing-pr.json",
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

    const text = output.mock.calls[0]?.[0] ?? "";
    expect(exitCode).toBe(1);
    expect(text).toContain("Decision: block");
    expect(text).toContain("Required check failed: test.");
  });

  it("executes approved create_pr through the fixture adapter and writes audit", () => {
    const dir = makeTempDir("codepm-workflow-create-pr-");
    const reviewOutput = vi.fn();

    const reviewExitCode = runCli(
      ["review-plan", "docs/examples/create-pr-proposal.md", "--json"],
      reviewOutput
    );

    expect(reviewExitCode).toBe(0);
    const decisionPath = join(dir, "decision.json");
    writeFileSync(decisionPath, reviewOutput.mock.calls[0]?.[0] ?? "", "utf8");
    const bodyPath = join(dir, "body.md");
    writeFileSync(
      bodyPath,
      [
        "## Test Plan",
        "",
        "- Run `npm test -- --run tests/unit/config`.",
        "",
        "## Rollback Plan",
        "",
        "Remove the documentation note before retrying."
      ].join("\n"),
      "utf8"
    );
    const scopePath = writeJson(dir, "scope.json", {
      repo: "octo/example",
      branch: "feature/local-doc-note",
      expectedHeadSha: "abc123passing",
      filesChanged: ["docs/examples/local-doc-note.md"]
    });
    const auditPath = join(dir, "audit.jsonl");
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
        "docs/examples/create-pr-proposal.md",
        "--repo",
        "octo/example",
        "--base-ref",
        "main",
        "--head-ref",
        "feature/local-doc-note",
        "--title",
        "Add local documentation note",
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
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Execution Status: created"
    );
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(3);
    expect(JSON.parse(auditLines[2] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "create_pr",
        decision: "approve",
        github: expect.objectContaining({
          result: "created",
          url: "https://github.com/octo/example/pull/77"
        })
      })
    );
  });
});
