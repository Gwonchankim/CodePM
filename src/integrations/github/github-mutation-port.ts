export interface GitHubCreatePullRequestInput {
  repo: string;
  baseRef: string;
  headRef: string;
  title: string;
  body: string;
  expectedHeadSha?: string;
  draft?: boolean;
}

export interface GitHubMergePullRequestInput {
  repo: string;
  prNumber: number;
  expectedHeadSha: string;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export type GitHubMutationAction = "create_pr" | "merge_pr";

export interface GitHubMutationSuccess {
  ok: true;
  action: GitHubMutationAction;
  repo: string;
  prNumber: number;
  url: string;
  result: "created" | "merged";
  headSha?: string;
  stateReadAt: string;
  mergeSha?: string;
}

export type GitHubMutationErrorCode =
  | "unauthorized"
  | "conflict"
  | "validation_failed"
  | "adapter_error";

export interface GitHubMutationFailure {
  ok: false;
  action: GitHubMutationAction;
  code: GitHubMutationErrorCode;
  message: string;
}

export type GitHubMutationResult =
  | GitHubMutationSuccess
  | GitHubMutationFailure;

export interface GitHubMutationAdapter {
  createPullRequest(
    input: GitHubCreatePullRequestInput
  ): GitHubMutationResult;
  mergePullRequest(input: GitHubMergePullRequestInput): GitHubMutationResult;
}
