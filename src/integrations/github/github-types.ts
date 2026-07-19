export type GitHubCheckStatus = "queued" | "in_progress" | "completed";

export type GitHubCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

export interface GitHubCheckRun {
  name: string;
  status: GitHubCheckStatus;
  conclusion?: GitHubCheckConclusion;
  detailsUrl?: string;
  completedAt?: string;
}

export type GitHubReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending";

export interface GitHubPullRequestReview {
  reviewer: string;
  state: GitHubReviewState;
  submittedAt?: string;
}

export interface GitHubReviewThread {
  id: string;
  path: string;
  line?: number;
  isResolved: boolean;
  summary?: string;
}

export type GitHubMergeabilityState =
  | "mergeable"
  | "blocked"
  | "conflicting"
  | "unknown";

export interface GitHubPullRequestMergeability {
  state: GitHubMergeabilityState;
  isDraft: boolean;
  canMerge: boolean;
  reason?: string;
}

export interface GitHubPullRequestState {
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  changedFiles: string[];
  checks: GitHubCheckRun[];
  reviews: GitHubPullRequestReview[];
  reviewThreads: GitHubReviewThread[];
  unresolvedThreads: GitHubReviewThread[];
  mergeability: GitHubPullRequestMergeability;
  readAt: string;
}

export interface GitHubPullRequestLocator {
  repo: string;
  prNumber: number;
}

export type GitHubReadErrorCode = "not_found" | "unauthorized" | "adapter_error";

export interface GitHubReadError {
  code: GitHubReadErrorCode;
  message: string;
}

export type GitHubPullRequestReadResult =
  | {
      ok: true;
      state: GitHubPullRequestState;
    }
  | {
      ok: false;
      error: GitHubReadError;
    };
