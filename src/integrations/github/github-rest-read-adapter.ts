import type { GitHubReadAdapter } from "./github-port.js";
import type {
  GitHubCheckConclusion,
  GitHubCheckRun,
  GitHubCheckStatus,
  GitHubMergeabilityState,
  GitHubPullRequestLocator,
  GitHubPullRequestReadResult,
  GitHubPullRequestReview,
  GitHubPullRequestState,
  GitHubReviewState,
  GitHubReviewThread
} from "./github-types.js";

export interface GitHubRestFetchResponse {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export type GitHubRestFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<GitHubRestFetchResponse>;

export interface GitHubRestReadAdapterOptions {
  token?: string;
  apiBaseUrl?: string;
  apiVersion?: string;
  fetchImpl?: GitHubRestFetch;
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2022-11-28";

export function createGitHubRestReadAdapter(
  options: GitHubRestReadAdapterOptions = {}
): GitHubReadAdapter {
  const fetchImpl = options.fetchImpl ?? getDefaultFetch();
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

  return {
    async readPullRequest(locator) {
      if (!fetchImpl) {
        return adapterError("Global fetch is not available in this runtime.");
      }

      const parsedLocator = parseLocator(locator);

      if (!parsedLocator.ok) {
        return adapterError(parsedLocator.message);
      }

      const { owner, repo } = parsedLocator;
      const request = createRequestContext({
        apiBaseUrl,
        apiVersion,
        token: options.token,
        fetchImpl
      });

      const prResult = await request.restJson(
        `/repos/${encodePath(owner)}/${encodePath(repo)}/pulls/${locator.prNumber}`,
        "pull request"
      );

      if (!prResult.ok) {
        return prResult.error;
      }

      const pr = parsePullRequest(prResult.value);

      if (!pr.ok) {
        return adapterError(pr.message);
      }

      const filesResult = await request.restJsonPages(
        `/repos/${encodePath(owner)}/${encodePath(repo)}/pulls/${locator.prNumber}/files?per_page=100`,
        "pull request files"
      );

      if (!filesResult.ok) {
        return filesResult.error;
      }

      const reviewsResult = await request.restJsonPages(
        `/repos/${encodePath(owner)}/${encodePath(repo)}/pulls/${locator.prNumber}/reviews?per_page=100`,
        "pull request reviews"
      );

      if (!reviewsResult.ok) {
        return reviewsResult.error;
      }

      const checkRunsResult = await readCheckRuns({
        request,
        path:
          `/repos/${encodePath(owner)}/${encodePath(repo)}/commits/${encodePath(pr.headSha)}/check-runs?per_page=100`
      });

      if (!checkRunsResult.ok) {
        return checkRunsResult.error;
      }

      const legacyStatusResult = await request.restJson(
        `/repos/${encodePath(owner)}/${encodePath(repo)}/commits/${encodePath(pr.headSha)}/status`,
        "commit status"
      );

      if (!legacyStatusResult.ok) {
        return legacyStatusResult.error;
      }

      const threadsResult = await readReviewThreads({
        request,
        owner,
        repo,
        prNumber: locator.prNumber
      });

      if (!threadsResult.ok) {
        return threadsResult.error;
      }

      const changedFiles = parseChangedFiles(filesResult.values);
      const reviews = parseReviews(reviewsResult.values);
      const legacyStatuses = parseLegacyStatuses(legacyStatusResult.value);

      if (!changedFiles.ok) {
        return adapterError(changedFiles.message);
      }

      if (!reviews.ok) {
        return adapterError(reviews.message);
      }

      if (!legacyStatuses.ok) {
        return adapterError(legacyStatuses.message);
      }

      return {
        ok: true,
        state: {
          repo: locator.repo,
          prNumber: locator.prNumber,
          title: pr.title,
          body: pr.body,
          baseRef: pr.baseRef,
          headRef: pr.headRef,
          headSha: pr.headSha,
          changedFiles: changedFiles.files,
          checks: [...checkRunsResult.checks, ...legacyStatuses.checks],
          reviews: reviews.reviews,
          reviewThreads: threadsResult.threads,
          unresolvedThreads: threadsResult.threads.filter(
            (thread) => !thread.isResolved
          ),
          mergeability: pr.mergeability,
          readAt: new Date().toISOString()
        }
      };
    }
  };
}

interface RequestContextOptions {
  apiBaseUrl: string;
  apiVersion: string;
  token?: string;
  fetchImpl: GitHubRestFetch;
}

interface RequestContext {
  restJson(
    path: string,
    label: string
  ): Promise<
    | { ok: true; value: unknown; response: GitHubRestFetchResponse }
    | { ok: false; error: GitHubPullRequestReadResult }
  >;
  restJsonPages(
    path: string,
    label: string
  ): Promise<
    | { ok: true; values: unknown[] }
    | { ok: false; error: GitHubPullRequestReadResult }
  >;
  graphQl(
    body: unknown,
    label: string
  ): Promise<
    | { ok: true; value: unknown; response: GitHubRestFetchResponse }
    | { ok: false; error: GitHubPullRequestReadResult }
  >;
}

async function readCheckRuns(input: {
  request: RequestContext;
  path: string;
}): Promise<
  | { ok: true; checks: GitHubCheckRun[] }
  | { ok: false; error: GitHubPullRequestReadResult }
> {
  const checks: GitHubCheckRun[] = [];
  let nextPathOrUrl: string | undefined = input.path;

  while (nextPathOrUrl) {
    const result = await input.request.restJson(nextPathOrUrl, "check runs");

    if (!result.ok) {
      return result;
    }

    const parsed = parseCheckRuns(result.value);

    if (!parsed.ok) {
      return {
        ok: false,
        error: adapterError(parsed.message)
      };
    }

    checks.push(...parsed.checks);
    nextPathOrUrl = parseNextLink(result.response.headers.get("link"));
  }

  return {
    ok: true,
    checks
  };
}

function createRequestContext(options: RequestContextOptions): RequestContext {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CodePM",
    "X-GitHub-Api-Version": options.apiVersion
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  async function requestJson(
    url: string,
    init: { method?: string; body?: string } | undefined,
    label: string
  ) {
    let response: GitHubRestFetchResponse;

    try {
      response = await options.fetchImpl(url, {
        method: init?.method,
        headers,
        body: init?.body
      });
    } catch {
      return {
        ok: false as const,
        error: adapterError(`GitHub request failed for ${label}.`)
      };
    }

    if (!response.ok) {
      return {
        ok: false as const,
        error: mapHttpError(response.status, response.headers, label)
      };
    }

    let text: string;

    try {
      text = await response.text();
    } catch {
      return {
        ok: false as const,
        error: adapterError(`Could not read GitHub response for ${label}.`)
      };
    }

    try {
      return {
        ok: true as const,
        value: JSON.parse(text) as unknown,
        response
      };
    } catch {
      return {
        ok: false as const,
        error: adapterError(`Invalid JSON from GitHub ${label}.`)
      };
    }
  }

  return {
    restJson(path, label) {
      return requestJson(buildApiUrl(options.apiBaseUrl, path), undefined, label);
    },
    async restJsonPages(path, label) {
      const values: unknown[] = [];
      let nextUrl: string | undefined = buildApiUrl(options.apiBaseUrl, path);

      while (nextUrl) {
        const result = await requestJson(nextUrl, undefined, label);

        if (!result.ok) {
          return result;
        }

        if (!Array.isArray(result.value)) {
          return {
            ok: false,
            error: adapterError(
              `Unexpected GitHub ${label} response shape.`
            )
          };
        }

        values.push(...result.value);
        nextUrl = parseNextLink(result.response.headers.get("link"));
      }

      return {
        ok: true,
        values
      };
    },
    graphQl(body, label) {
      return requestJson(
        buildApiUrl(options.apiBaseUrl, "/graphql"),
        {
          method: "POST",
          body: JSON.stringify(body)
        },
        label
      );
    }
  };
}

function getDefaultFetch(): GitHubRestFetch | undefined {
  if (typeof fetch !== "function") {
    return undefined;
  }

  return (url, init) => fetch(url, init);
}

function buildApiUrl(apiBaseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;

  return `${base}${suffix}`;
}

function parseNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  return linkHeader
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const match = /^<([^>]+)>;\s*rel="next"$/.exec(part);
      return match?.[1] ? [match[1]] : [];
    })[0];
}

function parseLocator(
  locator: GitHubPullRequestLocator
):
  | { ok: true; owner: string; repo: string }
  | { ok: false; message: string } {
  const parts = locator.repo.split("/");

  if (
    parts.length !== 2 ||
    !parts[0]?.trim() ||
    !parts[1]?.trim() ||
    !Number.isInteger(locator.prNumber) ||
    locator.prNumber < 1
  ) {
    return {
      ok: false,
      message: "Invalid GitHub PR locator. Expected repo owner/name and positive PR number."
    };
  }

  return {
    ok: true,
    owner: parts[0],
    repo: parts[1]
  };
}

function parsePullRequest(value: unknown):
  | {
      ok: true;
      title: string;
      body: string;
      baseRef: string;
      headRef: string;
      headSha: string;
      mergeability: GitHubPullRequestState["mergeability"];
    }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "Unexpected GitHub pull request response shape." };
  }

  const base = value.base;
  const head = value.head;

  if (
    typeof value.title !== "string" ||
    !(typeof value.body === "string" || value.body === null) ||
    !isRecord(base) ||
    !isRecord(head) ||
    typeof base.ref !== "string" ||
    typeof head.ref !== "string" ||
    typeof head.sha !== "string"
  ) {
    return { ok: false, message: "Unexpected GitHub pull request response shape." };
  }

  return {
    ok: true,
    title: value.title,
    body: value.body ?? "",
    baseRef: base.ref,
    headRef: head.ref,
    headSha: head.sha,
    mergeability: mapMergeability({
      draft: value.draft,
      mergeable: value.mergeable,
      mergeableState: value.mergeable_state
    })
  };
}

function parseChangedFiles(
  values: unknown[]
): { ok: true; files: string[] } | { ok: false; message: string } {
  const files: string[] = [];

  for (const value of values) {
    if (!isRecord(value) || typeof value.filename !== "string") {
      return {
        ok: false,
        message: "Unexpected GitHub pull request files response shape."
      };
    }

    files.push(value.filename);
  }

  return {
    ok: true,
    files: Array.from(new Set(files))
  };
}

function parseReviews(
  values: unknown[]
): { ok: true; reviews: GitHubPullRequestReview[] } | { ok: false; message: string } {
  const reviews: GitHubPullRequestReview[] = [];

  for (const value of values) {
    if (!isRecord(value) || typeof value.state !== "string") {
      return {
        ok: false,
        message: "Unexpected GitHub pull request reviews response shape."
      };
    }

    reviews.push({
      reviewer: parseReviewUser(value.user),
      state: mapReviewState(value.state),
      submittedAt:
        typeof value.submitted_at === "string" ? value.submitted_at : undefined
    });
  }

  return {
    ok: true,
    reviews
  };
}

function parseReviewUser(value: unknown): string {
  if (isRecord(value) && typeof value.login === "string") {
    return value.login;
  }

  return "unknown";
}

function parseCheckRuns(
  value: unknown
): { ok: true; checks: GitHubCheckRun[] } | { ok: false; message: string } {
  if (!isRecord(value) || !Array.isArray(value.check_runs)) {
    return {
      ok: false,
      message: "Unexpected GitHub check runs response shape."
    };
  }

  const checks: GitHubCheckRun[] = [];

  for (const run of value.check_runs) {
    if (!isRecord(run) || typeof run.name !== "string") {
      return {
        ok: false,
        message: "Unexpected GitHub check runs response shape."
      };
    }

    const status = mapCheckStatus(run.status);
    const conclusion = mapCheckConclusion(run.conclusion);

    checks.push({
      name: run.name,
      status,
      ...(conclusion ? { conclusion } : {}),
      ...(typeof run.details_url === "string"
        ? { detailsUrl: run.details_url }
        : {}),
      ...(typeof run.completed_at === "string"
        ? { completedAt: run.completed_at }
        : {})
    });
  }

  return {
    ok: true,
    checks
  };
}

function parseLegacyStatuses(
  value: unknown
): { ok: true; checks: GitHubCheckRun[] } | { ok: false; message: string } {
  if (!isRecord(value) || !Array.isArray(value.statuses)) {
    return {
      ok: false,
      message: "Unexpected GitHub commit status response shape."
    };
  }

  const checks: GitHubCheckRun[] = [];

  for (const status of value.statuses) {
    if (!isRecord(status) || typeof status.context !== "string") {
      return {
        ok: false,
        message: "Unexpected GitHub commit status response shape."
      };
    }

    const mapped = mapLegacyStatusState(status.state);

    checks.push({
      name: status.context,
      status: mapped.status,
      ...(mapped.conclusion ? { conclusion: mapped.conclusion } : {}),
      ...(typeof status.target_url === "string"
        ? { detailsUrl: status.target_url }
        : {}),
      ...(typeof status.updated_at === "string"
        ? { completedAt: status.updated_at }
        : {})
    });
  }

  return {
    ok: true,
    checks
  };
}

async function readReviewThreads(input: {
  request: RequestContext;
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<
  | { ok: true; threads: GitHubReviewThread[] }
  | { ok: false; error: GitHubPullRequestReadResult }
> {
  const threads: GitHubReviewThread[] = [];
  let after: string | null = null;

  do {
    const result = await input.request.graphQl(
      {
        query: REVIEW_THREADS_QUERY,
        variables: {
          owner: input.owner,
          repo: input.repo,
          number: input.prNumber,
          after
        }
      },
      "review threads"
    );

    if (!result.ok) {
      return result;
    }

    const page = parseReviewThreadPage(result.value);

    if (!page.ok) {
      return {
        ok: false,
        error: adapterError(page.message)
      };
    }

    threads.push(...page.threads);
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  return {
    ok: true,
    threads
  };
}

const REVIEW_THREADS_QUERY = `
query CodePmPullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          path
          line
          isResolved
          comments(first: 1) {
            nodes {
              bodyText
              body
            }
          }
        }
      }
    }
  }
}
`;

function parseReviewThreadPage(value: unknown):
  | {
      ok: true;
      threads: GitHubReviewThread[];
      hasNextPage: boolean;
      endCursor: string | null;
    }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "Unexpected GitHub review threads response shape." };
  }

  if (Array.isArray(value.errors) && value.errors.length > 0) {
    return { ok: false, message: "GitHub GraphQL returned review thread errors." };
  }

  const data = value.data;
  const repository = isRecord(data) ? data.repository : undefined;
  const pullRequest = isRecord(repository) ? repository.pullRequest : undefined;
  const reviewThreads = isRecord(pullRequest)
    ? pullRequest.reviewThreads
    : undefined;
  const pageInfo = isRecord(reviewThreads) ? reviewThreads.pageInfo : undefined;
  const nodes = isRecord(reviewThreads) ? reviewThreads.nodes : undefined;

  if (
    !isRecord(pageInfo) ||
    typeof pageInfo.hasNextPage !== "boolean" ||
    !(typeof pageInfo.endCursor === "string" || pageInfo.endCursor === null) ||
    !Array.isArray(nodes)
  ) {
    return { ok: false, message: "Unexpected GitHub review threads response shape." };
  }

  const threads: GitHubReviewThread[] = [];

  for (const node of nodes) {
    const thread = parseReviewThread(node);

    if (!thread.ok) {
      return thread;
    }

    threads.push(thread.thread);
  }

  return {
    ok: true,
    threads,
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor
  };
}

function parseReviewThread(
  value: unknown
): { ok: true; thread: GitHubReviewThread } | { ok: false; message: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.path !== "string" ||
    typeof value.isResolved !== "boolean"
  ) {
    return {
      ok: false,
      message: "Unexpected GitHub review threads response shape."
    };
  }

  const comments = isRecord(value.comments) && Array.isArray(value.comments.nodes)
    ? value.comments.nodes
    : [];

  return {
    ok: true,
    thread: {
      id: value.id,
      path: value.path,
      ...(typeof value.line === "number" ? { line: value.line } : {}),
      isResolved: value.isResolved,
      ...parseThreadSummary(comments)
    }
  };
}

function parseThreadSummary(comments: unknown[]): { summary?: string } {
  const first = comments[0];

  if (!isRecord(first)) {
    return {};
  }

  const summary =
    typeof first.bodyText === "string"
      ? first.bodyText
      : typeof first.body === "string"
        ? first.body
        : undefined;

  if (!summary || summary.trim().length === 0) {
    return {};
  }

  return {
    summary: summary.trim()
  };
}

function mapMergeability(input: {
  draft: unknown;
  mergeable: unknown;
  mergeableState: unknown;
}): GitHubPullRequestState["mergeability"] {
  const isDraft = input.draft === true;

  if (isDraft) {
    return {
      state: "blocked",
      isDraft: true,
      canMerge: false,
      reason: "Pull request is draft."
    };
  }

  if (input.mergeable === true) {
    return {
      state: "mergeable",
      isDraft: false,
      canMerge: true,
      reason: formatMergeableState(input.mergeableState)
    };
  }

  if (input.mergeable === false) {
    const state: GitHubMergeabilityState =
      input.mergeableState === "dirty" ? "conflicting" : "blocked";

    return {
      state,
      isDraft: false,
      canMerge: false,
      reason: formatMergeableState(input.mergeableState)
    };
  }

  return {
    state: "unknown",
    isDraft: false,
    canMerge: false,
    reason: "GitHub mergeability is not available yet."
  };
}

function formatMergeableState(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return `GitHub mergeable_state: ${value}.`;
  }

  return undefined;
}

function mapReviewState(state: string): GitHubReviewState {
  const normalized = state.toLowerCase();

  if (
    normalized === "approved" ||
    normalized === "changes_requested" ||
    normalized === "commented" ||
    normalized === "dismissed" ||
    normalized === "pending"
  ) {
    return normalized;
  }

  return "commented";
}

function mapCheckStatus(value: unknown): GitHubCheckStatus {
  if (
    value === "queued" ||
    value === "in_progress" ||
    value === "completed"
  ) {
    return value;
  }

  return "completed";
}

function mapCheckConclusion(value: unknown): GitHubCheckConclusion | undefined {
  if (
    value === "success" ||
    value === "failure" ||
    value === "neutral" ||
    value === "cancelled" ||
    value === "skipped" ||
    value === "timed_out" ||
    value === "action_required"
  ) {
    return value;
  }

  return undefined;
}

function mapLegacyStatusState(value: unknown): {
  status: GitHubCheckStatus;
  conclusion?: GitHubCheckConclusion;
} {
  if (value === "pending") {
    return {
      status: "in_progress"
    };
  }

  if (value === "success") {
    return {
      status: "completed",
      conclusion: "success"
    };
  }

  if (value === "failure" || value === "error") {
    return {
      status: "completed",
      conclusion: "failure"
    };
  }

  return {
    status: "completed"
  };
}

function mapHttpError(
  status: number,
  headers: { get(name: string): string | null },
  label: string
): GitHubPullRequestReadResult {
  if (status === 404) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `GitHub ${label} was not found.`
      }
    };
  }

  if (status === 401 || (status === 403 && headers.get("x-ratelimit-remaining") !== "0")) {
    return {
      ok: false,
      error: {
        code: "unauthorized",
        message: `GitHub ${label} could not be read with the provided credentials.`
      }
    };
  }

  return adapterError(`GitHub ${label} request failed with status ${status}.`);
}

function adapterError(message: string): GitHubPullRequestReadResult {
  return {
    ok: false,
    error: {
      code: "adapter_error",
      message
    }
  };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
