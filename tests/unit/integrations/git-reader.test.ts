import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readGitState } from "../../../src/integrations/git/git-reader.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-git-"));
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

describe("readGitState", () => {
  it("returns branch, changed files, status text, and local diff without mutating the repo", () => {
    const cwd = makeTempDir();
    initRepo(cwd);

    writeFileSync(join(cwd, "README.md"), "initial\n");
    commitAll(cwd, "initial commit");

    writeFileSync(join(cwd, "README.md"), "initial\nchanged locally\n");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "notes.md"), "untracked notes\n");

    const result = readGitState({ cwd });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.state.branch).toBe("main");
    expect(result.state.changedFiles).toEqual(
      expect.arrayContaining(["README.md", "docs/notes.md"])
    );
    expect(result.state.statusText).toContain("README.md");
    expect(result.state.statusText).toContain("docs/notes.md");
    expect(result.state.diffText).toContain("changed locally");
    expect(git(cwd, ["status", "--short", "--untracked-files=all"])).toContain(
      "docs/notes.md"
    );
  });

  it("compares repository changes against a configurable base ref", () => {
    const cwd = makeTempDir();
    initRepo(cwd);

    writeFileSync(join(cwd, "README.md"), "initial\n");
    commitAll(cwd, "initial commit");

    writeFileSync(join(cwd, "ImplementationPlan.md"), "task 9\n");
    commitAll(cwd, "add implementation plan");

    const result = readGitState({ cwd, baseRef: "HEAD~1" });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.state.baseRef).toBe("HEAD~1");
    expect(result.state.changedFiles).toContain("ImplementationPlan.md");
    expect(result.state.diffText).toContain("task 9");
  });

  it("reports a non-git directory without throwing", () => {
    const cwd = makeTempDir();

    const result = readGitState({ cwd });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not_git_repository",
        message: `${cwd} is not inside a git repository`
      }
    });
  });
});
