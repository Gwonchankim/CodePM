import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Decision } from "../../../src/domain/types.js";
import type { GitState } from "../../../src/integrations/git/git-types.js";
import type { ApprovalEvidence } from "../../../src/policy/approval-evidence.js";
import { runExecutionPreflight } from "../../../src/execution/execution-preflight.js";
import {
  executeGitPush,
  type GitPushRunner
} from "../../../src/execution/adapters/git-push-adapter.js";

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

const scope = {
  repo: "local/example",
  remote: "origin",
  branch: "feature/codepm",
  expectedHeadSha: "abc123",
  filesChanged: ["README.md"]
};

const cleanGitState: GitState = {
  cwd: "C:/repo",
  branch: "feature/codepm",
  changedFiles: ["README.md"],
  diffText: "diff --git a/README.md b/README.md\n+++ b/README.md\n+safe change\n",
  statusText: "",
  baseRef: "origin/main"
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-git-push-unit-"));
  tempDirs.push(dir);
  return dir;
}

function allowedPreflight() {
  return runExecutionPreflight({
    decision: approvedDecision,
    approvedAction: "push_branch",
    requestedAction: "push_branch",
    riskLevel: "low",
    reviewedScope: scope,
    currentScope: scope,
    now: "2026-05-25T00:30:00.000Z"
  });
}

function blockedPreflight() {
  return runExecutionPreflight({
    decision: {
      ...approvedDecision,
      decision: "request_changes"
    },
    approvedAction: "push_branch",
    requestedAction: "push_branch",
    riskLevel: "low",
    reviewedScope: scope,
    currentScope: scope,
    now: "2026-05-25T00:30:00.000Z"
  });
}

function fakeRunner(): { runner: GitPushRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitPushRunner = {
    pushBranch(input) {
      calls.push([
        input.remote,
        input.branch,
        input.force ? "--force-with-lease" : ""
      ]);

      return {
        ok: true,
        command: [
          "git",
          "-C",
          input.cwd,
          "push",
          input.remote,
          input.branch,
          ...(input.force ? ["--force-with-lease"] : [])
        ],
        stdout: "pushed\n",
        stderr: ""
      };
    },
    readHeadSha() {
      return {
        ok: true,
        command: ["git", "rev-parse", "HEAD"],
        stdout: "abc123\n",
        stderr: "",
        headSha: "abc123"
      };
    }
  };

  return { runner, calls };
}

function forcePushApproval(): ApprovalEvidence {
  return {
    schemaVersion: "codepm.approval.v1",
    approver: "amole",
    approvedAt: "2026-05-25T00:05:00.000Z",
    expiresAt: "2026-05-25T01:05:00.000Z",
    requestedAction: "push_branch",
    riskLevel: "high",
    scope: {
      ...scope,
      forcePush: true
    }
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("executeGitPush", () => {
  it("pushes an explicit branch to an explicit remote after preflight allow", () => {
    const { runner, calls } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      preflight: allowedPreflight(),
      gitState: cleanGitState,
      runner,
      now: "2026-05-25T00:31:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "pushed",
        command: ["git", "-C", "C:/repo", "push", "origin", "feature/codepm"]
      })
    );
    expect(calls).toEqual([["origin", "feature/codepm", ""]]);
  });

  it("requires explicit branch and remote target", () => {
    const { runner, calls } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "",
      branch: "",
      preflight: allowedPreflight(),
      gitState: cleanGitState,
      runner
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["missing_remote", "missing_branch"])
    );
    expect(calls).toEqual([]);
  });

  it("does not push when preflight is blocked", () => {
    const { runner, calls } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      preflight: blockedPreflight(),
      gitState: cleanGitState,
      runner
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.findings.map((finding) => finding.code)).toContain(
      "preflight_blocked"
    );
    expect(calls).toEqual([]);
  });

  it("blocks secret findings before push", () => {
    const { runner, calls } = fakeRunner();
    const gitStateWithSecret: GitState = {
      ...cleanGitState,
      diffText:
        "diff --git a/README.md b/README.md\n+++ b/README.md\n+token=synthetic-test-secret-token\n"
    };

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      preflight: allowedPreflight(),
      gitState: gitStateWithSecret,
      runner
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "secret_findings"
    );
    expect(JSON.stringify(result)).not.toContain(
      "synthetic-test-secret-token"
    );
    expect(calls).toEqual([]);
  });

  it("refuses force push without exact force approval", () => {
    const { runner, calls } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      force: true,
      preflight: allowedPreflight(),
      gitState: cleanGitState,
      runner
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "force_push_not_approved"
    );
    expect(calls).toEqual([]);
  });

  it("allows force push only with approval scoped to branch, remote, and force", () => {
    const { runner, calls } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      force: true,
      preflight: allowedPreflight(),
      approval: forcePushApproval(),
      gitState: cleanGitState,
      runner
    });

    expect(result.ok).toBe(true);
    expect(result.command).toEqual([
      "git",
      "-C",
      "C:/repo",
      "push",
      "origin",
      "feature/codepm",
      "--force-with-lease"
    ]);
    expect(calls).toEqual([["origin", "feature/codepm", "--force-with-lease"]]);
  });

  it("records command, result, and final state in audit output", () => {
    const auditPath = join(makeTempDir(), "audit.jsonl");
    const { runner } = fakeRunner();

    const result = executeGitPush({
      cwd: "C:/repo",
      remote: "origin",
      branch: "feature/codepm",
      preflight: allowedPreflight(),
      gitState: cleanGitState,
      runner,
      auditLogPath: auditPath,
      now: "2026-05-25T00:31:00.000Z"
    });

    expect(result.ok).toBe(true);
    const audit = JSON.parse(readFileSync(auditPath, "utf8").trim());
    expect(audit).toEqual(
      expect.objectContaining({
        requestedAction: "push_branch",
        decision: "approve",
        reason: "Git push succeeded for origin feature/codepm.",
        github: expect.objectContaining({
          command: "git -C C:/repo push origin feature/codepm",
          result: "success",
          finalHeadSha: "abc123"
        })
      })
    );
  });
});
