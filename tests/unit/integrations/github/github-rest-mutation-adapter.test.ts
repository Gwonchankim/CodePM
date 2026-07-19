import { describe, expect, it } from "vitest";

import {
  createGitHubRestMutationAdapter,
  type GitHubRestMutationAdapterOptions
} from "../../../../src/integrations/github/github-rest-mutation-adapter.js";
import type {
  GitHubRestFetch,
  GitHubRestFetchResponse
} from "../../../../src/integrations/github/github-rest-read-adapter.js";

interface FetchCall {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

const API_BASE_URL = "https://api.github.test";
const TOKEN = "synthetic-mutation-test-token";

describe("createGitHubRestMutationAdapter", () => {
  it("creates a pull request with expected headers, body, and normalized result", async () => {
    const calls: FetchCall[] = [];
    const adapter = createAdapter({ fetchImpl: createSuccessfulFetch(calls) });

    const result = await adapter.createPullRequest({
      repo: "octo/example",
      baseRef: "main",
      headRef: "feature/rest-mutation",
      title: "Add REST mutation adapter",
      body: "Includes test evidence and rollback.",
      expectedHeadSha: "abc123head",
      draft: true
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: "create_pr",
        repo: "octo/example",
        prNumber: 77,
        url: "https://github.com/octo/example/pull/77",
        result: "created",
        headSha: "abc123head",
        stateReadAt: expect.any(String)
      })
    );
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/repos/octo/example/commits/feature%2Frest-mutation`,
      `${API_BASE_URL}/repos/octo/example/pulls`
    ]);
    expect(calls[0]?.init).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${TOKEN}`,
          "User-Agent": "CodePM",
          "X-GitHub-Api-Version": "2022-11-28"
        })
      })
    );
    expect(JSON.parse(calls[1]?.init?.body ?? "{}")).toEqual({
      base: "main",
      head: "feature/rest-mutation",
      title: "Add REST mutation adapter",
      body: "Includes test evidence and rollback.",
      draft: true
    });
  });

  it("blocks PR creation before POST when the expected head SHA no longer matches", async () => {
    const calls: FetchCall[] = [];
    const adapter = createAdapter({
      fetchImpl: createSuccessfulFetch(calls, {
        commitSha: "changed-head"
      })
    });

    const result = await adapter.createPullRequest({
      repo: "octo/example",
      baseRef: "main",
      headRef: "feature/rest-mutation",
      title: "Add REST mutation adapter",
      body: "Body",
      expectedHeadSha: "abc123head"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        action: "create_pr",
        code: "conflict",
        message: "GitHub head ref feature/rest-mutation changed before PR creation."
      })
    );
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/repos/octo/example/commits/feature%2Frest-mutation`
    ]);
  });

  it("blocks fork-style head refs with expected head SHA before fetch", async () => {
    const calls: FetchCall[] = [];
    const adapter = createAdapter({ fetchImpl: createSuccessfulFetch(calls) });

    const result = await adapter.createPullRequest({
      repo: "octo/example",
      baseRef: "main",
      headRef: "fork-owner:feature/rest-mutation",
      title: "Add REST mutation adapter",
      body: "Body",
      expectedHeadSha: "abc123head"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        action: "create_pr",
        code: "validation_failed"
      })
    );
    expect(calls).toEqual([]);
  });

  it("merges a pull request with expected SHA, method, and normalized merge result", async () => {
    const calls: FetchCall[] = [];
    const adapter = createAdapter({ fetchImpl: createSuccessfulFetch(calls) });

    const result = await adapter.mergePullRequest({
      repo: "octo/example",
      prNumber: 42,
      expectedHeadSha: "abc123head",
      mergeMethod: "squash"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: "merge_pr",
        repo: "octo/example",
        prNumber: 42,
        url: "https://github.com/octo/example/pull/42",
        result: "merged",
        headSha: "abc123head",
        mergeSha: "merge-sha-123",
        stateReadAt: expect.any(String)
      })
    );
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/repos/octo/example/pulls/42/merge`
    ]);
    expect(calls[0]?.init).toEqual(
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28"
        })
      })
    );
    expect(JSON.parse(calls[0]?.init?.body ?? "{}")).toEqual({
      sha: "abc123head",
      merge_method: "squash"
    });
  });

  it("blocks invalid repo, disallowed repo, invalid PR number, and empty token before fetch", async () => {
    const calls: FetchCall[] = [];
    const adapter = createAdapter({ fetchImpl: createSuccessfulFetch(calls) });
    const noToken = createGitHubRestMutationAdapter({
      token: "",
      allowedRepos: ["octo/example"],
      apiBaseUrl: API_BASE_URL,
      fetchImpl: createSuccessfulFetch(calls)
    });

    await expect(
      adapter.createPullRequest({
        repo: "octo/example/extra",
        baseRef: "main",
        headRef: "feature/rest-mutation",
        title: "Title",
        body: "Body"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "validation_failed"
      })
    );
    await expect(
      adapter.createPullRequest({
        repo: "octo/other",
        baseRef: "main",
        headRef: "feature/rest-mutation",
        title: "Title",
        body: "Body"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "validation_failed"
      })
    );
    await expect(
      adapter.mergePullRequest({
        repo: "octo/example",
        prNumber: 0,
        expectedHeadSha: "abc123head"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "validation_failed"
      })
    );
    await expect(
      noToken.mergePullRequest({
        repo: "octo/example",
        prNumber: 42,
        expectedHeadSha: "abc123head"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "unauthorized"
      })
    );
    expect(calls).toEqual([]);
  });

  it("maps HTTP failures to typed mutation errors", async () => {
    await expect(expectCreateError(response({ message: TOKEN }, { status: 401 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "unauthorized",
        message: expect.not.stringContaining(TOKEN)
      })
    );
    await expect(expectCreateError(response({ message: "missing" }, { status: 404 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "validation_failed"
      })
    );
    await expect(expectCreateError(response({ message: "conflict" }, { status: 409 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "conflict"
      })
    );
    await expect(expectCreateError(response({ message: "bad" }, { status: 422 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "validation_failed"
      })
    );
    await expect(
      expectCreateError(
        response(
          { message: "rate limited" },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } }
        )
      )
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "adapter_error"
      })
    );
    await expect(expectCreateError(response({ message: "boom" }, { status: 500 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "adapter_error"
      })
    );
  });

  it("returns adapter_error for fetch failures, invalid JSON, and unexpected shapes without leaking bodies", async () => {
    const rawSecretBody = "raw response body includes synthetic-secret-response-body";

    await expect(expectCreateError(textResponse(rawSecretBody))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "adapter_error",
        message: expect.not.stringContaining(rawSecretBody)
      })
    );
    await expect(expectCreateError(response({ number: "bad" }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "adapter_error",
        message: "Unexpected GitHub create PR response shape."
      })
    );

    const adapter = createAdapter({
      fetchImpl: async () => {
        throw new Error(`network failed ${TOKEN}`);
      }
    });

    await expect(
      adapter.mergePullRequest({
        repo: "octo/example",
        prNumber: 42,
        expectedHeadSha: "abc123head"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "adapter_error",
        message: expect.not.stringContaining(TOKEN)
      })
    );
  });
});

function createAdapter(
  overrides: Partial<GitHubRestMutationAdapterOptions> = {}
) {
  return createGitHubRestMutationAdapter({
    token: TOKEN,
    allowedRepos: ["octo/example"],
    apiBaseUrl: API_BASE_URL,
    ...overrides
  });
}

async function expectCreateError(firstResponse: GitHubRestFetchResponse) {
  const adapter = createAdapter({
    fetchImpl: async () => firstResponse
  });

  return adapter.createPullRequest({
    repo: "octo/example",
    baseRef: "main",
    headRef: "feature/rest-mutation",
    title: "Add REST mutation adapter",
    body: "Sensitive body should not be echoed."
  });
}

function createSuccessfulFetch(
  calls: FetchCall[],
  options: {
    commitSha?: string;
  } = {}
): GitHubRestFetch {
  return async (url, init) => {
    calls.push({ url, init });

    if (url === `${API_BASE_URL}/repos/octo/example/commits/feature%2Frest-mutation`) {
      return response({
        sha: options.commitSha ?? "abc123head"
      });
    }

    if (url === `${API_BASE_URL}/repos/octo/example/pulls`) {
      return response(
        {
          number: 77,
          html_url: "https://github.com/octo/example/pull/77",
          head: { sha: "abc123head" }
        },
        { status: 201 }
      );
    }

    if (url === `${API_BASE_URL}/repos/octo/example/pulls/42/merge`) {
      return response({
        sha: "merge-sha-123",
        merged: true,
        message: "Pull Request successfully merged"
      });
    }

    return response({ message: `Unexpected URL ${url}` }, { status: 500 });
  };
}

function response(
  value: unknown,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {}
): GitHubRestFetchResponse {
  return textResponse(JSON.stringify(value), options);
}

function textResponse(
  text: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {}
): GitHubRestFetchResponse {
  const status = options.status ?? 200;
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      }
    },
    async text() {
      return text;
    }
  };
}
