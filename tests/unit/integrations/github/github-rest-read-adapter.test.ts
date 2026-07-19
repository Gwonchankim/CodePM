import { describe, expect, it } from "vitest";

import {
  createGitHubRestReadAdapter,
  type GitHubRestFetch,
  type GitHubRestFetchResponse
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
const TOKEN = "synthetic-read-test-token";

describe("createGitHubRestReadAdapter", () => {
  it("normalizes pull request state from REST and GraphQL responses", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = createSuccessfulFetch(calls);
    const adapter = createGitHubRestReadAdapter({
      apiBaseUrl: API_BASE_URL,
      token: TOKEN,
      fetchImpl
    });

    const result = await adapter.readPullRequest({
      repo: "octo/example",
      prNumber: 42
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        state: expect.objectContaining({
          repo: "octo/example",
          prNumber: 42,
          title: "Add real GitHub read adapter",
          body: "Read-only adapter body.",
          baseRef: "main",
          headRef: "feature/github-read-adapter",
          headSha: "abc123real",
          changedFiles: ["README.md", "src/index.ts"],
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: "test",
              status: "completed",
              conclusion: "success"
            }),
            expect.objectContaining({
              name: "lint",
              status: "completed",
              conclusion: "failure"
            }),
            expect.objectContaining({
              name: "legacy-ci",
              status: "completed",
              conclusion: "success"
            })
          ]),
          reviews: [
            {
              reviewer: "alice",
              state: "approved",
              submittedAt: "2026-05-25T00:00:00Z"
            },
            {
              reviewer: "bob",
              state: "changes_requested",
              submittedAt: "2026-05-25T00:01:00Z"
            }
          ],
          reviewThreads: expect.arrayContaining([
            expect.objectContaining({
              id: "thread-1",
              path: "README.md",
              line: 12,
              isResolved: true,
              summary: "Looks good."
            }),
            expect.objectContaining({
              id: "thread-2",
              path: "src/index.ts",
              line: 9,
              isResolved: false,
              summary: "Please adjust this."
            })
          ]),
          unresolvedThreads: [
            expect.objectContaining({
              id: "thread-2",
              isResolved: false
            })
          ],
          mergeability: {
            state: "mergeable",
            isDraft: false,
            canMerge: true,
            reason: "GitHub mergeable_state: clean."
          }
        })
      })
    );

    expect(result.ok && result.state.readAt).toEqual(expect.any(String));
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/repos/octo/example/pulls/42`,
      `${API_BASE_URL}/repos/octo/example/pulls/42/files?per_page=100`,
      `${API_BASE_URL}/repos/octo/example/pulls/42/files?page=2`,
      `${API_BASE_URL}/repos/octo/example/pulls/42/reviews?per_page=100`,
      `${API_BASE_URL}/repos/octo/example/commits/abc123real/check-runs?per_page=100`,
      `${API_BASE_URL}/repos/octo/example/commits/abc123real/check-runs?page=2`,
      `${API_BASE_URL}/repos/octo/example/commits/abc123real/status`,
      `${API_BASE_URL}/graphql`,
      `${API_BASE_URL}/graphql`
    ]);
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      })
    );
    expect(JSON.parse(calls[7]?.init?.body ?? "{}")).toEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ after: null })
      })
    );
    expect(JSON.parse(calls[8]?.init?.body ?? "{}")).toEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ after: "cursor-1" })
      })
    );
  });

  it("does not send an authorization header when no token is configured", async () => {
    const calls: FetchCall[] = [];
    const adapter = createGitHubRestReadAdapter({
      apiBaseUrl: API_BASE_URL,
      fetchImpl: createSuccessfulFetch(calls)
    });

    await adapter.readPullRequest({ repo: "octo/example", prNumber: 42 });

    expect(calls[0]?.init?.headers).not.toHaveProperty("Authorization");
  });

  it("maps draft, conflicting, and unknown mergeability safely", async () => {
    await expectReadMergeability(
      { draft: true, mergeable: true, mergeable_state: "clean" },
      {
        state: "blocked",
        isDraft: true,
        canMerge: false,
        reason: "Pull request is draft."
      }
    );
    await expectReadMergeability(
      { draft: false, mergeable: false, mergeable_state: "dirty" },
      {
        state: "conflicting",
        isDraft: false,
        canMerge: false,
        reason: "GitHub mergeable_state: dirty."
      }
    );
    await expectReadMergeability(
      { draft: false, mergeable: null, mergeable_state: "unknown" },
      {
        state: "unknown",
        isDraft: false,
        canMerge: false,
        reason: "GitHub mergeability is not available yet."
      }
    );
  });

  it("returns typed errors for HTTP failures", async () => {
    await expect(expectReadError(response({ message: "bad credentials" }, { status: 401 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "unauthorized",
          message: expect.not.stringContaining(TOKEN)
        })
      })
    );
    await expect(expectReadError(response({ message: "missing" }, { status: 404 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "not_found" })
      })
    );
    await expect(expectReadError(
      response(
        { message: "rate limited" },
        { status: 403, headers: { "x-ratelimit-remaining": "0" } }
      )
    )).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "adapter_error" })
      })
    );
  });

  it("returns adapter_error for malformed input and response bodies", async () => {
    const calls: FetchCall[] = [];
    const adapter = createGitHubRestReadAdapter({
      apiBaseUrl: API_BASE_URL,
      fetchImpl: createSuccessfulFetch(calls)
    });

    await expect(
      adapter.readPullRequest({ repo: "octo/example/extra", prNumber: 42 })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "adapter_error" })
      })
    );
    expect(calls).toEqual([]);

    await expect(expectReadError(textResponse("{not json"))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "adapter_error",
          message: "Invalid JSON from GitHub pull request."
        })
      })
    );

    await expect(expectReadError(response({ title: 42 }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "adapter_error",
          message: "Unexpected GitHub pull request response shape."
        })
      })
    );
  });

  it("returns adapter_error for GraphQL errors and unexpected shapes", async () => {
    await expect(expectReadWithGraphQl(response({ errors: [{ message: "boom" }] }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "adapter_error",
          message: "GitHub GraphQL returned review thread errors."
        })
      })
    );

    await expect(expectReadWithGraphQl(response({ data: { repository: null } }))).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "adapter_error",
          message: "Unexpected GitHub review threads response shape."
        })
      })
    );
  });
});

async function expectReadMergeability(
  prOverrides: Record<string, unknown>,
  expected: Record<string, unknown>
): Promise<void> {
  const adapter = createGitHubRestReadAdapter({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: createSuccessfulFetch([], { prOverrides })
  });

  const result = await adapter.readPullRequest({
    repo: "octo/example",
    prNumber: 42
  });

  expect(result).toEqual(
    expect.objectContaining({
      ok: true,
      state: expect.objectContaining({
        mergeability: expected
      })
    })
  );
}

async function expectReadError(firstResponse: GitHubRestFetchResponse) {
  const adapter = createGitHubRestReadAdapter({
    apiBaseUrl: API_BASE_URL,
    token: TOKEN,
    fetchImpl: async () => firstResponse
  });

  return adapter.readPullRequest({
    repo: "octo/example",
    prNumber: 42
  });
}

async function expectReadWithGraphQl(graphQlResponse: GitHubRestFetchResponse) {
  const adapter = createGitHubRestReadAdapter({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: createSuccessfulFetch([], { graphQlResponse })
  });

  return adapter.readPullRequest({
    repo: "octo/example",
    prNumber: 42
  });
}

function createSuccessfulFetch(
  calls: FetchCall[],
  options: {
    prOverrides?: Record<string, unknown>;
    graphQlResponse?: GitHubRestFetchResponse;
  } = {}
): GitHubRestFetch {
  return async (url, init) => {
    calls.push({ url, init });

    if (url === `${API_BASE_URL}/repos/octo/example/pulls/42`) {
      return response({
        title: "Add real GitHub read adapter",
        body: "Read-only adapter body.",
        base: { ref: "main" },
        head: {
          ref: "feature/github-read-adapter",
          sha: "abc123real"
        },
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        ...options.prOverrides
      });
    }

    if (url === `${API_BASE_URL}/repos/octo/example/pulls/42/files?per_page=100`) {
      return response([{ filename: "README.md" }], {
        headers: {
          link: `<${API_BASE_URL}/repos/octo/example/pulls/42/files?page=2>; rel="next"`
        }
      });
    }

    if (url === `${API_BASE_URL}/repos/octo/example/pulls/42/files?page=2`) {
      return response([{ filename: "src/index.ts" }]);
    }

    if (url === `${API_BASE_URL}/repos/octo/example/pulls/42/reviews?per_page=100`) {
      return response([
        {
          user: { login: "alice" },
          state: "APPROVED",
          submitted_at: "2026-05-25T00:00:00Z"
        },
        {
          user: { login: "bob" },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-05-25T00:01:00Z"
        }
      ]);
    }

    if (url === `${API_BASE_URL}/repos/octo/example/commits/abc123real/check-runs?per_page=100`) {
      return response(
        {
          check_runs: [
            {
              name: "test",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.example/checks/1",
              completed_at: "2026-05-25T00:02:00Z"
            }
          ]
        },
        {
          headers: {
            link: `<${API_BASE_URL}/repos/octo/example/commits/abc123real/check-runs?page=2>; rel="next"`
          }
        }
      );
    }

    if (url === `${API_BASE_URL}/repos/octo/example/commits/abc123real/check-runs?page=2`) {
      return response({
        check_runs: [
          {
            name: "lint",
            status: "completed",
            conclusion: "failure"
          }
        ]
      });
    }

    if (url === `${API_BASE_URL}/repos/octo/example/commits/abc123real/status`) {
      return response({
        statuses: [
          {
            context: "legacy-ci",
            state: "success",
            target_url: "https://github.example/status/1",
            updated_at: "2026-05-25T00:03:00Z"
          }
        ]
      });
    }

    if (url === `${API_BASE_URL}/graphql`) {
      if (options.graphQlResponse) {
        return options.graphQlResponse;
      }

      const body = JSON.parse(init?.body ?? "{}") as {
        variables?: { after?: string | null };
      };

      if (body.variables?.after === "cursor-1") {
        return response(graphQlThreadPage(false, null, [
          {
            id: "thread-2",
            path: "src/index.ts",
            line: 9,
            isResolved: false,
            comments: {
              nodes: [{ bodyText: "Please adjust this." }]
            }
          }
        ]));
      }

      return response(graphQlThreadPage(true, "cursor-1", [
        {
          id: "thread-1",
          path: "README.md",
          line: 12,
          isResolved: true,
          comments: {
            nodes: [{ bodyText: "Looks good." }]
          }
        }
      ]));
    }

    return response({ message: `Unexpected URL ${url}` }, { status: 500 });
  };
}

function graphQlThreadPage(
  hasNextPage: boolean,
  endCursor: string | null,
  nodes: unknown[]
): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: {
              hasNextPage,
              endCursor
            },
            nodes
          }
        }
      }
    }
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
