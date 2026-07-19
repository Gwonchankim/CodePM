import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Decision } from "../../src/domain/types.js";
import { runExecutionPreflight } from "../../src/execution/execution-preflight.js";
import { executeGitPush } from "../../src/execution/adapters/git-push-adapter.js";

const tempDirs: string[] = [];

const approvedDecision: Decision = {
  decision: "approve",
  summary: "Branch push is approved.",
  requiredChanges: [],
  risks: [],
  verificationRequired: ["Re-check local state before push."],
  approvedActions: ["Proceed to execution preflight for push_branch."],
  blockedActions: ["Do not push if branch or diff changes."]
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-git-push-integration-"));
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("git push execution adapter", () => {
  it("pushes a local branch to a bare repository after preflight allow", () => {
    const root = makeTempDir();
    const remote = join(root, "remote.git");
    const repo = join(root, "repo");

    git(root, ["init", "--bare", remote]);
    mkdirSync(repo);
    initRepo(repo);
    writeFileSync(join(repo, "README.md"), "initial\n", "utf8");
    commitAll(repo, "initial commit");
    git(repo, ["remote", "add", "origin", remote]);

    const headSha = git(repo, ["rev-parse", "HEAD"]).trim();
    const scope = {
      repo: "local/example",
      remote: "origin",
      branch: "main",
      expectedHeadSha: headSha,
      filesChanged: ["README.md"]
    };
    const preflight = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "push_branch",
      requestedAction: "push_branch",
      riskLevel: "low",
      reviewedScope: scope,
      currentScope: scope,
      now: "2026-05-25T00:30:00.000Z"
    });

    const result = executeGitPush({
      cwd: repo,
      remote: "origin",
      branch: "main",
      preflight,
      gitState: {
        cwd: repo,
        branch: "main",
        changedFiles: ["README.md"],
        diffText:
          "diff --git a/README.md b/README.md\n+++ b/README.md\n+initial\n",
        statusText: ""
      }
    });

    expect(result.ok).toBe(true);
    expect(git(remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(headSha);
  });
});
