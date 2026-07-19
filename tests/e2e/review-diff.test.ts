import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/index.js";
import { CODEPM_CONFIG_SCHEMA_VERSION } from "../../src/config/config-schema.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-review-diff-"));
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

function makeProposalFile(
  dir: string,
  filesExpectedToChange: string[] = ["README.md"]
): string {
  const path = join(dir, "proposal.md");
  writeFileSync(
    path,
    [
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
      "- Run review-diff e2e tests.",
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
      "Revert the local implementation changes.",
      "",
      "## Open Questions",
      "",
      "- None."
    ].join("\n"),
    "utf8"
  );
  return path;
}

function setupRepoWithReadme(): { root: string; repo: string; proposal: string } {
  const root = makeTempDir();
  const repo = join(root, "repo");
  mkdirSync(repo);
  initRepo(repo);
  writeFileSync(join(repo, "README.md"), "initial\n", "utf8");
  commitAll(repo, "initial commit");
  const proposal = makeProposalFile(root);
  return { root, repo, proposal };
}

function writeConfig(repo: string, value: unknown): string {
  const path = join(repo, "codepm.config.json");
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

function runInRepo(repo: string, args: string[], output = vi.fn()): number {
  process.chdir(repo);
  try {
    return runCli(args, output);
  } finally {
    process.chdir(originalCwd);
  }
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

describe("codepm review-diff", () => {
  it("approves local changes that match the proposal scope", () => {
    const { repo, proposal } = setupRepoWithReadme();
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Gate Decision");
    expect(text).toContain("Decision: approve");
    expect(text).toContain("matches the approved proposal scope");
  });

  it("requests changes for files outside the proposal scope", () => {
    const { repo, proposal } = setupRepoWithReadme();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "unexpected.ts"), "export const x = 1;\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain(
      "Remove or justify unexpected file change: src/unexpected.ts."
    );
  });

  it("blocks secret-like values without printing the raw credential", () => {
    const { repo, proposal } = setupRepoWithReadme();
    const fakeToken = "synthetic-test-secret-token";
    writeFileSync(join(repo, "README.md"), `initial\ntoken=${fakeToken}\n`, "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: block");
    expect(text).toContain("Secret-like value detected in README.md: token");
    expect(text).not.toContain(fakeToken);
  });

  it("prints structured JSON and appends audit when requested", () => {
    const { repo, proposal, root } = setupRepoWithReadme();
    const auditPath = join(root, "audit.jsonl");
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(
      repo,
      ["review-diff", "--proposal", proposal, "--json", "--audit-log", auditPath],
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
        requestedAction: "implementation_review",
        decision: "approve",
        filesChanged: ["README.md"],
        riskLevel: "low"
      })
    );
  });

  it("prints Claude-facing feedback when requested", () => {
    const { repo, proposal } = setupRepoWithReadme();
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(
      repo,
      ["review-diff", "--proposal", proposal, "--feedback-for-claude"],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Feedback For Claude");
    expect(text).toContain("Decision: approve");
  });

  it("returns actionable output when run outside a git repository", () => {
    const root = makeTempDir();
    const proposal = makeProposalFile(root);
    const output = vi.fn();

    const exitCode = runInRepo(root, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "is not inside a git repository"
    );
  });

  it("uses review.maxChangedFiles from config for broad diff review", () => {
    const root = makeTempDir();
    const repo = join(root, "repo");
    mkdirSync(repo);
    initRepo(repo);
    writeFileSync(join(repo, "a.txt"), "initial\n", "utf8");
    writeConfig(repo, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      review: {
        maxChangedFiles: 1
      }
    });
    commitAll(repo, "initial commit");
    const proposal = makeProposalFile(root, ["a.txt", "b.txt"]);
    writeFileSync(join(repo, "a.txt"), "initial\nchanged\n", "utf8");
    writeFileSync(join(repo, "b.txt"), "new\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain(
      "Reduce the diff scope or update the proposal for a broad change set: 2 files changed, limit is 1."
    );
  });

  it("uses review.additionalSensitivePaths from config", () => {
    const root = makeTempDir();
    const repo = join(root, "repo");
    mkdirSync(repo);
    initRepo(repo);
    mkdirSync(join(repo, "infra"));
    mkdirSync(join(repo, "infra", "prod"));
    writeFileSync(join(repo, "infra", "prod", "app.yml"), "initial\n", "utf8");
    writeConfig(repo, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      review: {
        additionalSensitivePaths: ["infra/prod/**"]
      }
    });
    commitAll(repo, "initial commit");
    const proposal = makeProposalFile(root, ["infra/prod/app.yml"]);
    writeFileSync(join(repo, "infra", "prod", "app.yml"), "initial\nchanged\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: block");
    expect(text).toContain(
      "Sensitive path changed: infra/prod/app.yml (project configured sensitive path)"
    );
  });

  it("lets --base-ref override defaults.baseRef from config", () => {
    const { repo, proposal } = setupRepoWithReadme();
    writeConfig(repo, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      defaults: {
        baseRef: "missing-base-ref"
      }
    });
    commitAll(repo, "commit config");
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(
      repo,
      ["review-diff", "--proposal", proposal, "--base-ref", "HEAD"],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.mock.calls[0]?.[0] ?? "").toContain("Decision: approve");
  });

  it("returns actionable output for invalid config before review", () => {
    const { repo, proposal } = setupRepoWithReadme();
    writeConfig(repo, {
      schemaVersion: "codepm.config.v0",
      review: {
        maxChangedFiles: 0
      }
    });
    writeFileSync(join(repo, "README.md"), "initial\nplanned change\n", "utf8");
    const output = vi.fn();

    const exitCode = runInRepo(repo, ["review-diff", "--proposal", proposal], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Invalid CodePM config at");
    expect(text).toContain("schemaVersion: Expected schemaVersion codepm.config.v1.");
    expect(text).toContain(
      "review.maxChangedFiles: review.maxChangedFiles must be a positive integer."
    );
    expect(text).not.toContain("# PM Gate Decision");
  });
});
