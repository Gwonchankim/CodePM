import { execFileSync } from "node:child_process";

export interface GitPushBranchInput {
  cwd: string;
  remote: string;
  branch: string;
  force?: boolean;
}

export interface GitCommandSuccess {
  ok: true;
  command: string[];
  stdout: string;
  stderr: string;
}

export interface GitCommandFailure {
  ok: false;
  command: string[];
  stdout: string;
  stderr: string;
  message: string;
}

export type GitCommandResult = GitCommandSuccess | GitCommandFailure;

export interface GitHeadResult extends GitCommandSuccess {
  headSha: string;
}

export interface GitPushRunner {
  pushBranch(input: GitPushBranchInput): GitCommandResult;
  readHeadSha(cwd: string): GitHeadResult | GitCommandFailure;
}

export const realGitPushRunner: GitPushRunner = {
  pushBranch(input) {
    return runGit(input.cwd, [
      "push",
      input.remote,
      input.branch,
      ...(input.force ? ["--force-with-lease"] : [])
    ]);
  },
  readHeadSha(cwd) {
    const result = runGit(cwd, ["rev-parse", "HEAD"]);

    if (!result.ok) {
      return result;
    }

    return {
      ...result,
      headSha: result.stdout.trim()
    };
  }
};

function runGit(cwd: string, args: string[]): GitCommandResult {
  const command = ["git", "-C", cwd, ...args];

  try {
    const stdout = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      ok: true,
      command,
      stdout,
      stderr: ""
    };
  } catch (error) {
    return {
      ok: false,
      command,
      stdout: getExecOutput(error, "stdout"),
      stderr: getExecOutput(error, "stderr"),
      message: getErrorMessage(error)
    };
  }
}

function getExecOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (error && typeof error === "object" && key in error) {
    const value = (error as Record<string, unknown>)[key];

    if (typeof value === "string") {
      return value;
    }

    if (value instanceof Buffer) {
      return value.toString("utf8");
    }
  }

  return "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Git command failed.";
}
