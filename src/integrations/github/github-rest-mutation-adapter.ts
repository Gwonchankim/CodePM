import type {
  GitHubCreatePullRequestInput,
  GitHubMergePullRequestInput,
  GitHubMutationAction,
  GitHubMutationErrorCode,
  GitHubMutationFailure,
  GitHubMutationResult
} from "./github-mutation-port.js";
import type {
  GitHubRestFetch,
  GitHubRestFetchResponse
} from "./github-rest-read-adapter.js";

export interface GitHubRestMutationAdapter {
  createPullRequest(
    input: GitHubCreatePullRequestInput
  ): Promise<GitHubMutationResult>;
  mergePullRequest(input: GitHubMergePullRequestInput): Promise<GitHubMutationResult>;
}

export interface GitHubRestMutationAdapterOptions {
  token: string;
  allowedRepos: string[];
  apiBaseUrl?: string;
  apiVersion?: string;
  fetchImpl?: GitHubRestFetch;
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2022-11-28";

export function createGitHubRestMutationAdapter(
  options: GitHubRestMutationAdapterOptions
): GitHubRestMutationAdapter {
  const fetchImpl = options.fetchImpl ?? getDefaultFetch();
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

  return {
    async createPullRequest(input) {
      const guard = validateMutationInput({
        action: "create_pr",
        repo: input.repo,
        token: options.token,
        allowedRepos: options.allowedRepos,
        fetchImpl
      });

      if (!guard.ok) {
        return guard.error;
      }

      const parsed = guard.parsedRepo;
      const request = createRequestContext({
        apiBaseUrl,
        apiVersion,
        token: options.token,
        fetchImpl: guard.fetchImpl
      });

      if (input.expectedHeadSha) {
        if (input.headRef.includes(":")) {
          return failure(
            "create_pr",
            "validation_failed",
            "PR creation expected head SHA checks are supported only for same-repository head refs."
          );
        }

        const headResult = await request.json(
          "GET",
          `/repos/${encodePath(parsed.owner)}/${encodePath(parsed.name)}/commits/${encodePath(input.headRef)}`,
          undefined,
          "create PR head ref"
        );

        if (!headResult.ok) {
          return headResult.error("create_pr");
        }

        const headSha = parseCommitSha(headResult.value);

        if (!headSha.ok) {
          return failure("create_pr", "adapter_error", headSha.message);
        }

        if (headSha.sha !== input.expectedHeadSha) {
          return failure(
            "create_pr",
            "conflict",
            `GitHub head ref ${input.headRef} changed before PR creation.`
          );
        }
      }

      const body: Record<string, unknown> = {
        title: input.title,
        body: input.body,
        base: input.baseRef,
        head: input.headRef
      };

      if (typeof input.draft === "boolean") {
        body.draft = input.draft;
      }

      const createResult = await request.json(
        "POST",
        `/repos/${encodePath(parsed.owner)}/${encodePath(parsed.name)}/pulls`,
        body,
        "create PR"
      );

      if (!createResult.ok) {
        return createResult.error("create_pr");
      }

      const pr = parseCreatePullRequestResponse(createResult.value);

      if (!pr.ok) {
        return failure("create_pr", "adapter_error", pr.message);
      }

      return {
        ok: true,
        action: "create_pr",
        repo: input.repo,
        prNumber: pr.prNumber,
        url: pr.url,
        result: "created",
        headSha: pr.headSha ?? input.expectedHeadSha,
        stateReadAt: new Date().toISOString()
      };
    },
    async mergePullRequest(input) {
      const guard = validateMutationInput({
        action: "merge_pr",
        repo: input.repo,
        prNumber: input.prNumber,
        token: options.token,
        allowedRepos: options.allowedRepos,
        fetchImpl
      });

      if (!guard.ok) {
        return guard.error;
      }

      const parsed = guard.parsedRepo;
      const request = createRequestContext({
        apiBaseUrl,
        apiVersion,
        token: options.token,
        fetchImpl: guard.fetchImpl
      });
      const body: Record<string, unknown> = {
        sha: input.expectedHeadSha
      };

      if (input.mergeMethod) {
        body.merge_method = input.mergeMethod;
      }

      const mergeResult = await request.json(
        "PUT",
        `/repos/${encodePath(parsed.owner)}/${encodePath(parsed.name)}/pulls/${input.prNumber}/merge`,
        body,
        "merge PR"
      );

      if (!mergeResult.ok) {
        return mergeResult.error("merge_pr");
      }

      const merge = parseMergePullRequestResponse(mergeResult.value);

      if (!merge.ok) {
        return failure("merge_pr", "adapter_error", merge.message);
      }

      return {
        ok: true,
        action: "merge_pr",
        repo: input.repo,
        prNumber: input.prNumber,
        url: `https://github.com/${input.repo}/pull/${input.prNumber}`,
        result: "merged",
        headSha: input.expectedHeadSha,
        stateReadAt: new Date().toISOString(),
        mergeSha: merge.mergeSha
      };
    }
  };
}

interface ParsedRepo {
  owner: string;
  name: string;
}

function validateMutationInput(input: {
  action: GitHubMutationAction;
  repo: string;
  token: string;
  allowedRepos: string[];
  fetchImpl?: GitHubRestFetch;
  prNumber?: number;
}):
  | { ok: true; parsedRepo: ParsedRepo; fetchImpl: GitHubRestFetch }
  | { ok: false; error: GitHubMutationFailure } {
  const parsed = parseRepo(input.repo);

  if (!parsed.ok) {
    return {
      ok: false,
      error: failure(input.action, "validation_failed", parsed.message)
    };
  }

  if (
    typeof input.prNumber === "number" &&
    (!Number.isInteger(input.prNumber) || input.prNumber < 1)
  ) {
    return {
      ok: false,
      error: failure(
        input.action,
        "validation_failed",
        "GitHub mutation requires a positive pull request number."
      )
    };
  }

  if (!Array.isArray(input.allowedRepos) || !input.allowedRepos.includes(input.repo)) {
    return {
      ok: false,
      error: failure(
        input.action,
        "validation_failed",
        `GitHub mutation target ${input.repo} is not in the allowed repo list.`
      )
    };
  }

  if (typeof input.token !== "string" || input.token.trim().length === 0) {
    return {
      ok: false,
      error: failure(
        input.action,
        "unauthorized",
        "GitHub mutation requires a non-empty token."
      )
    };
  }

  if (!input.fetchImpl) {
    return {
      ok: false,
      error: failure(
        input.action,
        "adapter_error",
        "Global fetch is not available in this runtime."
      )
    };
  }

  return {
    ok: true,
    parsedRepo: parsed.repo,
    fetchImpl: input.fetchImpl
  };
}

function parseRepo(
  repo: string
): { ok: true; repo: ParsedRepo } | { ok: false; message: string } {
  const parts = repo.split("/");

  if (
    parts.length !== 2 ||
    !parts[0]?.trim() ||
    !parts[1]?.trim()
  ) {
    return {
      ok: false,
      message: "Invalid GitHub repo. Expected owner/name."
    };
  }

  return {
    ok: true,
    repo: {
      owner: parts[0],
      name: parts[1]
    }
  };
}

interface RequestContext {
  json(
    method: "GET" | "POST" | "PUT",
    path: string,
    body: Record<string, unknown> | undefined,
    label: string
  ): Promise<
    | { ok: true; value: unknown; response: GitHubRestFetchResponse }
    | {
        ok: false;
        error(action: GitHubMutationAction): GitHubMutationFailure;
      }
  >;
}

function createRequestContext(input: {
  apiBaseUrl: string;
  apiVersion: string;
  token: string;
  fetchImpl: GitHubRestFetch;
}): RequestContext {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${input.token}`,
    "User-Agent": "CodePM",
    "X-GitHub-Api-Version": input.apiVersion
  };

  return {
    async json(method, path, body, label) {
      let response: GitHubRestFetchResponse;

      try {
        response = await input.fetchImpl(buildApiUrl(input.apiBaseUrl, path), {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {})
        });
      } catch {
        return {
          ok: false,
          error(action) {
            return failure(
              action,
              "adapter_error",
              `GitHub request failed for ${label}.`
            );
          }
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          error(action) {
            return mapHttpError(action, response.status, response.headers, label);
          }
        };
      }

      let text: string;

      try {
        text = await response.text();
      } catch {
        return {
          ok: false,
          error(action) {
            return failure(
              action,
              "adapter_error",
              `Could not read GitHub response for ${label}.`
            );
          }
        };
      }

      try {
        return {
          ok: true,
          value: JSON.parse(text) as unknown,
          response
        };
      } catch {
        return {
          ok: false,
          error(action) {
            return failure(
              action,
              "adapter_error",
              `Invalid JSON from GitHub ${label}.`
            );
          }
        };
      }
    }
  };
}

function parseCommitSha(
  value: unknown
): { ok: true; sha: string } | { ok: false; message: string } {
  if (!isRecord(value) || typeof value.sha !== "string") {
    return {
      ok: false,
      message: "Unexpected GitHub commit response shape."
    };
  }

  return {
    ok: true,
    sha: value.sha
  };
}

function parseCreatePullRequestResponse(
  value: unknown
):
  | { ok: true; prNumber: number; url: string; headSha?: string }
  | { ok: false; message: string } {
  if (!isRecord(value) || typeof value.html_url !== "string") {
    return {
      ok: false,
      message: "Unexpected GitHub create PR response shape."
    };
  }

  const prNumber = value.number;

  if (typeof prNumber !== "number" || !Number.isInteger(prNumber)) {
    return {
      ok: false,
      message: "Unexpected GitHub create PR response shape."
    };
  }

  const head = value.head;

  return {
    ok: true,
    prNumber,
    url: value.html_url,
    ...(isRecord(head) && typeof head.sha === "string"
      ? { headSha: head.sha }
      : {})
  };
}

function parseMergePullRequestResponse(
  value: unknown
): { ok: true; mergeSha?: string } | { ok: false; message: string } {
  if (!isRecord(value) || value.merged !== true) {
    return {
      ok: false,
      message: "Unexpected GitHub merge PR response shape."
    };
  }

  return {
    ok: true,
    ...(typeof value.sha === "string" ? { mergeSha: value.sha } : {})
  };
}

function mapHttpError(
  action: GitHubMutationAction,
  status: number,
  headers: { get(name: string): string | null },
  label: string
): GitHubMutationFailure {
  if (status === 401 || (status === 403 && headers.get("x-ratelimit-remaining") !== "0")) {
    return failure(
      action,
      "unauthorized",
      `GitHub ${label} could not be performed with the provided credentials.`
    );
  }

  if (status === 409) {
    return failure(action, "conflict", `GitHub ${label} reported a conflict.`);
  }

  if (status === 404 || status === 422) {
    return failure(
      action,
      "validation_failed",
      `GitHub ${label} rejected the request.`
    );
  }

  return failure(
    action,
    "adapter_error",
    `GitHub ${label} request failed with status ${status}.`
  );
}

function failure(
  action: GitHubMutationAction,
  code: GitHubMutationErrorCode,
  message: string
): GitHubMutationFailure {
  return {
    ok: false,
    action,
    code,
    message
  };
}

function getDefaultFetch(): GitHubRestFetch | undefined {
  if (typeof fetch !== "function") {
    return undefined;
  }

  return (url, init) => fetch(url, init);
}

function buildApiUrl(apiBaseUrl: string, path: string): string {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;

  return `${base}${suffix}`;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
