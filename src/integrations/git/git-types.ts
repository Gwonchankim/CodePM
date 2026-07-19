export interface ReadGitStateOptions {
  cwd: string;
  baseRef?: string;
}

export interface GitState {
  cwd: string;
  branch: string;
  baseRef?: string;
  changedFiles: string[];
  diffText: string;
  statusText: string;
}

export type GitReadErrorCode = "not_git_repository" | "git_command_failed";

export interface GitReadError {
  code: GitReadErrorCode;
  message: string;
}

export type GitReadResult =
  | {
      ok: true;
      state: GitState;
    }
  | {
      ok: false;
      error: GitReadError;
    };
