import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type { GitReadResult, ReadGitStateOptions } from "./git-types.js";

export function readGitState(options: ReadGitStateOptions): GitReadResult {
  const cwd = resolve(options.cwd);

  if (!isInsideGitWorkTree(cwd)) {
    return {
      ok: false,
      error: {
        code: "not_git_repository",
        message: `${cwd} is not inside a git repository`
      }
    };
  }

  try {
    const branch = readCurrentBranch(cwd);
    const statusText = runGit(cwd, [
      "status",
      "--short",
      "--untracked-files=all"
    ]).trimEnd();
    const diffText = readDiffText(cwd, options.baseRef);
    const changedFiles = unique([
      ...readDiffFileNames(cwd, options.baseRef),
      ...parseStatusFiles(statusText)
    ]);

    return {
      ok: true,
      state: {
        cwd,
        branch,
        baseRef: options.baseRef,
        changedFiles,
        diffText,
        statusText
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "git_command_failed",
        message: getErrorMessage(error)
      }
    };
  }
}

function isInsideGitWorkTree(cwd: string): boolean {
  try {
    return runGit(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

function readCurrentBranch(cwd: string): string {
  const branch = runGit(cwd, ["branch", "--show-current"]).trim();

  if (branch.length > 0) {
    return branch;
  }

  try {
    return runGit(cwd, ["rev-parse", "--short", "HEAD"]).trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

function readDiffText(cwd: string, baseRef: string | undefined): string {
  if (baseRef) {
    return runGit(cwd, ["diff", baseRef, "--"]).trimEnd();
  }

  return [
    runGit(cwd, ["diff", "--"]).trimEnd(),
    runGit(cwd, ["diff", "--cached", "--"]).trimEnd()
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function readDiffFileNames(cwd: string, baseRef: string | undefined): string[] {
  if (baseRef) {
    return splitLines(runGit(cwd, ["diff", "--name-only", baseRef, "--"]));
  }

  return [
    ...splitLines(runGit(cwd, ["diff", "--name-only", "--"])),
    ...splitLines(runGit(cwd, ["diff", "--name-only", "--cached", "--"]))
  ];
}

function parseStatusFiles(statusText: string): string[] {
  return statusText
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const path = line.slice(3).trim();
      const renameSeparator = " -> ";

      if (path.includes(renameSeparator)) {
        return path.slice(path.indexOf(renameSeparator) + renameSeparator.length);
      }

      return path;
    });
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Git command failed";
}
