import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEPM_PLUGIN_CAPABILITIES,
  createFixtureGitHubReadAdapter,
  type GitHubRestFetch,
  reviewProposalForClaude,
  reviewPullRequestFromGitHubForClaude,
  reviewPullRequestForClaude,
  type GitHubPullRequestState
} from "../../src/index.js";

const githubTokenEnvName = "CODEPM_PLUGIN_TEST_GITHUB_TOKEN";
const githubToken = "synthetic-plugin-test-token";
const apiBaseUrl = "https://api.github.test";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readGithubFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readText(`tests/fixtures/github/${name}.json`)
  ) as GitHubPullRequestState;
}

afterEach(() => {
  delete process.env[githubTokenEnvName];
});

describe("CodePM plugin wrapper", () => {
  it("reviews a proposal and returns Claude-facing feedback", () => {
    const result = reviewProposalForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/valid-plan.md")
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );
    expect(result.decisionMarkdown).toContain("# PM Gate Decision");
    expect(result.feedbackMarkdown).toContain("# PM Feedback For Claude");
    expect(result.feedbackMarkdown).toContain("Decision: approve");
  });

  it("reviews pull request state through an injected GitHub read adapter", async () => {
    const adapter = createFixtureGitHubReadAdapter([
      readGithubFixture("passing-pr"),
      readGithubFixture("failing-pr")
    ]);
    const proposalMarkdown = readText("tests/fixtures/proposals/merge-pr-plan.md");

    await expect(
      reviewPullRequestForClaude({
        proposalMarkdown,
        locator: { repo: "octo/example", prNumber: 42 },
        githubAdapter: adapter,
        expectedHeadSha: "abc123passing",
        requiredCheckNames: ["test"]
      })
    ).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );

    await expect(
      reviewPullRequestForClaude({
        proposalMarkdown,
        locator: { repo: "octo/example", prNumber: 43 },
        githubAdapter: adapter,
        expectedHeadSha: "abc123failing",
        requiredCheckNames: ["test"]
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        status: "block",
        decision: expect.objectContaining({
          decision: "block",
          risks: expect.arrayContaining(["Required check failed: test."])
        })
      })
    );
  });

  it("returns a safe adapter_error result when PR state cannot be read", async () => {
    const adapter = createFixtureGitHubReadAdapter([]);

    const result = await reviewPullRequestForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      locator: { repo: "octo/example", prNumber: 404 },
      githubAdapter: adapter,
      expectedHeadSha: "missing",
      requiredCheckNames: ["test"]
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "adapter_error",
        decision: expect.objectContaining({ decision: "block" })
      })
    );
    expect(result.feedbackMarkdown).toContain(
      "GitHub PR state not found for octo/example#404"
    );
  });

  it("reviews live GitHub PR state through the read-only adapter helper", async () => {
    process.env[githubTokenEnvName] = githubToken;
    const calls: FetchCall[] = [];

    const result = await reviewPullRequestFromGitHubForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      locator: { repo: "octo/example", prNumber: 42 },
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"],
      tokenEnv: githubTokenEnvName,
      apiBaseUrl,
      fetchImpl: createGitHubFetch(calls, readGithubFixture("passing-pr"))
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.plugin.v1",
        ok: true,
        status: "approve",
        decision: expect.objectContaining({ decision: "approve" })
      })
    );
    expect(calls[0]?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      })
    );
  });

  it("blocks failing live GitHub PR state through the helper", async () => {
    process.env[githubTokenEnvName] = githubToken;

    const result = await reviewPullRequestFromGitHubForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      locator: { repo: "octo/example", prNumber: 43 },
      expectedHeadSha: "abc123failing",
      requiredCheckNames: ["test"],
      tokenEnv: githubTokenEnvName,
      apiBaseUrl,
      fetchImpl: createGitHubFetch([], readGithubFixture("failing-pr"))
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "block",
        decision: expect.objectContaining({
          decision: "block",
          risks: expect.arrayContaining(["Required check failed: test."])
        })
      })
    );
  });

  it("returns adapter_error before fetch when the GitHub token env is missing", async () => {
    const fetchImpl: GitHubRestFetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await reviewPullRequestFromGitHubForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      locator: { repo: "octo/example", prNumber: 42 },
      tokenEnv: githubTokenEnvName,
      apiBaseUrl,
      fetchImpl
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "adapter_error",
        decision: expect.objectContaining({ decision: "block" })
      })
    );
    expect(result.feedbackMarkdown).toContain(
      `Missing GitHub token. Set ${githubTokenEnvName}`
    );
  });

  it("does not expose token values in adapter error feedback", async () => {
    process.env[githubTokenEnvName] = githubToken;

    const result = await reviewPullRequestFromGitHubForClaude({
      proposalMarkdown: readText("tests/fixtures/proposals/merge-pr-plan.md"),
      locator: { repo: "octo/example", prNumber: 42 },
      tokenEnv: githubTokenEnvName,
      apiBaseUrl,
      fetchImpl: async () => response({ message: githubToken }, { status: 401 })
    });

    expect(result.status).toBe("adapter_error");
    expect(result.feedbackMarkdown).toContain("GitHub pull request");
    expect(result.feedbackMarkdown).not.toContain(githubToken);
  });

  it("advertises review-only plugin capabilities", () => {
    expect(CODEPM_PLUGIN_CAPABILITIES).toEqual({
      schemaVersion: "codepm.plugin.v1",
      supportsProposalReview: true,
      supportsPullRequestReview: true,
      supportsRealGitHubPullRequestReview: true,
      supportsExecutionMutation: false
    });
  });

  it("includes a repo-local Codex plugin manifest and skill", () => {
    const manifest = JSON.parse(
      readText("plugins/codepm/.codex-plugin/plugin.json")
    ) as Record<string, unknown>;
    const skill = readText("plugins/codepm/skills/codepm/SKILL.md");

    expect(manifest).toEqual(
      expect.objectContaining({
        name: "codepm",
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        description: expect.stringContaining("CodePM"),
        skills: "./skills/",
        mcpServers: "./.mcp.json",
        interface: expect.objectContaining({
          displayName: "CodePM"
        })
      })
    );
    const mcpConfig = JSON.parse(
      readText("plugins/codepm/.mcp.json")
    ) as Record<string, unknown>;

    expect(mcpConfig).toEqual({
      mcpServers: {
        codepm: {
          command: "node",
          args: ["../../dist/mcp/index.js"]
        }
      }
    });
    expect(manifest).not.toHaveProperty("apps");
    expect(skill).toContain("execute-action");
    expect(skill).toContain("codepm_review_proposal");
    expect(skill).toContain("codepm_review_pr_github");
    expect(skill).toContain("MCP companion only exposes");
    expect(skill).toContain("Do not bypass");
  });

  it("documents local MCP setup and execution boundaries", () => {
    const readme = readText("README.md");
    const mcpDocs = readText("docs/mcp.md");
    const pluginDocs = readText("docs/plugin.md");
    const configurationDocs = readText("docs/configuration.md");
    const githubReadDocs = readText("docs/github-read-adapter.md");
    const githubMutationDocs = readText("docs/github-mutation-adapter.md");
    const githubMutationConfigDocs = readText("docs/github-mutation-config.md");
    const marketplaceDocs = readText("docs/marketplace.md");
    const appConnectorDocs = readText("docs/app-connector.md");
    const setupExample = readText("docs/examples/mcp-local-setup.md");
    const workflowDocs = readText("docs/workflows/claude-codex-loop.md");
    const githubReadExample = readText("docs/examples/github-read-review.md");
    const githubMutationExample = readText(
      "docs/examples/github-mutation-execution.md"
    );
    const activeConfigExample = readText("docs/examples/codepm.config.json");
    const combinedDocs = [
      readme,
      workflowDocs,
      mcpDocs,
      pluginDocs,
      configurationDocs,
      githubReadDocs,
      githubMutationDocs,
      githubMutationConfigDocs,
      marketplaceDocs,
      appConnectorDocs,
      setupExample,
      githubReadExample,
      githubMutationExample
    ].join("\n");

    expect(readme).toContain("Codex Plugin / MCP");
    expect(readme).toContain("plugins/codepm");
    expect(readme).toContain("node dist/mcp/index.js --help");
    expect(readme).toContain("codepm execute-action");
    expect(readme).toContain("Package Readiness");
    expect(readme).toContain("npm run pack:dry-run");
    expect(readme).toContain("npm run pack:smoke");
    expect(readme).toContain("npm run release:check");
    expect(readme).toContain("docs/marketplace.md");
    expect(readme).toContain("docs/app-connector.md");
    expect(readme).toContain("docs/github-mutation-adapter.md");
    expect(readme).toContain("docs/examples/github-mutation-execution.md");
    expect(readme).toContain("docs/github-mutation-config.md");

    expect(mcpDocs).toContain("CODEPM_MCP_ALLOWED_ROOTS");
    expect(mcpDocs).toContain("C:\\Users\\amole\\Desktop\\CodePM;C:\\work\\project");
    expect(mcpDocs).toContain("/home/me/CodePM:/work/project");
    expect(mcpDocs).toContain("node ../../dist/mcp/index.js");
    expect(mcpDocs).toContain("plugins/codepm");
    expect(mcpDocs).toContain("execute-action --github-mutation-adapter github");
    expect(mcpDocs).toContain("MCP does not");
    expect(mcpDocs).toContain("expose it");

    expect(pluginDocs).toContain("Local Validation Checklist");
    expect(pluginDocs).toContain("npm run pack:dry-run");
    expect(pluginDocs).toContain("npm run pack:smoke");
    expect(pluginDocs).toContain("validate_plugin.py plugins\\codepm");
    expect(pluginDocs).toContain("docs/examples/codepm-marketplace.json");
    expect(pluginDocs).toContain("execute-action --github-mutation-adapter github");
    expect(pluginDocs).toContain("plugin wrapper");
    expect(pluginDocs).toContain("does not expose it");
    expect(configurationDocs).toContain("github.adapterMode");
    expect(configurationDocs).toContain("fixture");
    expect(configurationDocs).toContain("--github-result <fixture.json>");
    expect(configurationDocs).toContain("--github-mutation-adapter github");
    expect(configurationDocs).toContain("Config cannot set or default this real mutation");
    expect(githubReadDocs).toContain("codepm execute-action --github-mutation-adapter");
    expect(githubReadDocs).toContain("Config, MCP, plugin, app connector, or Browser fallback mutation wiring");
    expect(githubMutationDocs).toContain("Low-Level REST Mutation Adapter");
    expect(githubMutationDocs).toContain("GitHub Mutation Adapter");
    expect(githubMutationDocs).toContain("--github-mutation-adapter github");
    expect(githubMutationDocs).toContain("`github.adapterMode` supports only `fixture`");
    expect(githubMutationDocs).toContain("`--github-result <fixture.json>` is required");
    expect(githubMutationDocs).toContain("`createGitHubRestMutationAdapter`");
    expect(githubMutationDocs).toContain("allowedRepos");
    expect(githubMutationDocs).toContain("POST /repos/{owner}/{repo}/pulls");
    expect(githubMutationDocs).toContain("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge");
    expect(githubMutationDocs).toContain("token env based authentication");
    expect(githubMutationDocs).toContain("least-privilege GitHub token scopes");
    expect(githubMutationDocs).toContain("repo allowlist");
    expect(githubMutationDocs).toContain("expected head SHA");
    expect(githubMutationDocs).toContain("PR gate");
    expect(githubMutationDocs).toContain("audit intended and observed records");
    expect(githubMutationDocs).toContain("MCP, plugin, app connector, or Browser mutation surfaces");
    expect(githubMutationDocs).toContain("Optional Manual Live Smoke");
    expect(githubMutationDocs).toContain("docs/github-mutation-config.md");
    expect(githubMutationConfigDocs).toContain("GitHub Mutation Config Design");
    expect(githubMutationConfigDocs).toContain("preview only");
    expect(githubMutationConfigDocs).toContain("not active");
    expect(githubMutationConfigDocs).toContain("github.mutationAdapterMode");
    expect(githubMutationConfigDocs).toContain("github.mutationTokenEnv");
    expect(githubMutationConfigDocs).toContain("github.mutationAllowedRepos");
    expect(githubMutationConfigDocs).toContain("github.mutationApiBaseUrl");
    expect(githubMutationConfigDocs).toContain("github.mutationApiVersion");
    expect(githubMutationConfigDocs).toContain("CLI precedence");
    expect(githubMutationConfigDocs).toContain("--github-mutation-adapter");
    expect(githubMutationConfigDocs).toContain("--github-token-env");
    expect(githubMutationConfigDocs).toContain("--github-allowed-repo");
    expect(githubMutationConfigDocs).toContain("exact owner/name");
    expect(githubMutationConfigDocs).toContain("Do not put raw token values");
    expect(githubMutationConfigDocs).toContain("MCP, plugin, app connector, and Browser fallback cannot enable mutation");
    expect(githubMutationConfigDocs).not.toContain('"token":');
    expect(githubMutationConfigDocs).not.toContain("ghp_");
    expect(githubMutationConfigDocs).not.toContain("github_pat_");
    expect(marketplaceDocs).toContain("Marketplace Packaging Prep");
    expect(marketplaceDocs).toContain("plugins/codepm");
    expect(marketplaceDocs).toContain("./plugins/codepm");
    expect(marketplaceDocs).toContain('policy.installation: "AVAILABLE"');
    expect(marketplaceDocs).toContain('policy.authentication: "ON_INSTALL"');
    expect(marketplaceDocs).toContain('category: "Productivity"');
    expect(marketplaceDocs).toContain("Do not create or update `.agents/plugins/marketplace.json`");
    expect(marketplaceDocs).toContain("Do not register CodePM in a marketplace");
    expect(marketplaceDocs).toContain("Do not add an app connector");
    expect(marketplaceDocs).toContain("Do not run `npm publish`");
    expect(marketplaceDocs).toContain("docs/app-connector.md");
    expect(appConnectorDocs).toContain("App Connector Integration Prep");
    expect(appConnectorDocs).toContain("repo-local plugin + MCP review-only connector");
    expect(appConnectorDocs).toContain("connector id");
    expect(appConnectorDocs).toContain("owning account/team");
    expect(appConnectorDocs).toContain("auth policy");
    expect(appConnectorDocs).toContain("app registration target");
    expect(appConnectorDocs).toContain("privacy policy URL");
    expect(appConnectorDocs).toContain("terms of service URL");
    expect(appConnectorDocs).toContain("homepage URL");
    expect(appConnectorDocs).toContain("repository URL");
    expect(appConnectorDocs).toContain("Do not create `plugins/codepm/.app.json`");
    expect(appConnectorDocs).toContain("Do not add `apps` to `plugins/codepm/.codex-plugin/plugin.json`");
    expect(appConnectorDocs).toContain("Do not expose push, PR creation, merge, Browser fallback, or `execute-action` bypass");
    expect(appConnectorDocs).toContain("review-only actions first");
    expect(appConnectorDocs).toContain("separate human-gated task");
    expect(setupExample).toContain("MCP Local Setup Example");
    expect(setupExample).toContain("codepm_review_diff");
    expect(githubReadExample).toContain("GitHub Read Review Example");
    expect(githubReadExample).toContain("review-pr --adapter github");
    expect(githubReadExample).toContain('prReadAdapterMode": "github"');
    expect(githubReadExample).toContain("codepm_review_pr_github");
    expect(githubReadExample).toContain("reviewPullRequestFromGitHubForClaude");
    expect(githubReadExample).toContain("apiBaseUrl");
    expect(githubReadExample).toContain("apiVersion");
    expect(githubReadExample).not.toContain('"token":');
    expect(githubReadExample).not.toContain("token:");
    expect(githubMutationExample).toContain("GitHub Mutation Execution Example");
    expect(githubMutationExample).toContain("Fixture mode remains the default");
    expect(githubMutationExample).toContain("execute-action --github-mutation-adapter github");
    expect(githubMutationExample).toContain("--github-token-env GITHUB_TOKEN");
    expect(githubMutationExample).toContain("--github-allowed-repo");
    expect(githubMutationExample).toContain("--expected-head-sha");
    expect(githubMutationExample).toContain("--audit-log");
    expect(githubMutationExample).toContain("--json");
    expect(githubMutationExample).toContain("--github-result <fixture.json>");
    expect(githubMutationExample).toContain("Optional Manual Live Smoke");
    expect(githubMutationExample).toContain("Do not pass raw token values");
    expect(githubMutationExample).toContain("MCP, plugin, app connector, and Browser fallback cannot enable or bypass");
    expect(githubMutationExample).toContain("docs/github-mutation-config.md");
    expect(githubMutationExample).not.toContain('"token":');
    expect(githubMutationExample).not.toContain("ghp_");
    expect(githubMutationExample).not.toContain("github_pat_");
    expect(activeConfigExample).not.toContain("mutationAdapterMode");
    expect(activeConfigExample).not.toContain("mutationTokenEnv");
    expect(activeConfigExample).not.toContain("mutationAllowedRepos");

    expect(combinedDocs).toContain("CODEPM_MCP_ALLOWED_ROOTS");
    expect(combinedDocs).toContain("codepm_review_diff");
    expect(combinedDocs).toContain("codepm_review_pr_github");
    expect(combinedDocs).toContain("review-pr --adapter github");
    expect(combinedDocs).toContain("reviewPullRequestFromGitHubForClaude");
    expect(combinedDocs).toContain("GITHUB_TOKEN");
    expect(combinedDocs).toContain("supportsExecutionMutation: false");
    expect(combinedDocs).toContain("npm run build");
    expect(combinedDocs).toContain("npm run pack:dry-run");
    expect(combinedDocs).toContain("npm run pack:smoke");
    expect(combinedDocs).toContain("node dist/mcp/index.js --help");
    expect(combinedDocs).toContain("Marketplace registration remains a future human-gated task");
    expect(combinedDocs).toContain("Actual app connector creation and registration remain future work");
    expect(combinedDocs).toContain("Mutation remains outside MCP");
    expect(combinedDocs).toContain("--github-mutation-adapter github");
    expect(combinedDocs).toContain("Config, MCP, plugin, app connector");
    expect(combinedDocs).toContain("bypass GitHub mutation");
    expect(combinedDocs).toContain("Optional Manual Live Smoke");
    expect(combinedDocs).toContain("github.mutationAdapterMode");
  });

  it("provides a marketplace entry example without registering it", () => {
    const marketplace = JSON.parse(
      readText("docs/examples/codepm-marketplace.json")
    ) as {
      name: string;
      interface: { displayName: string };
      plugins: Array<{
        name: string;
        source: { source: string; path: string };
        policy: {
          installation: string;
          authentication: string;
          products?: string[];
        };
        category: string;
      }>;
    };
    const entry = marketplace.plugins[0];

    expect(marketplace.name).toBe("codepm");
    expect(marketplace.interface.displayName).toBe("CodePM");
    expect(marketplace.plugins).toHaveLength(1);
    expect(entry).toEqual(
      expect.objectContaining({
        name: "codepm",
        source: {
          source: "local",
          path: "./plugins/codepm"
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: "Productivity"
      })
    );
    expect(entry.policy).not.toHaveProperty("products");
    expect(existsSync(".agents/plugins/marketplace.json")).toBe(false);
  });

  it("documents app connector prep without creating an app connector", () => {
    const manifest = JSON.parse(
      readText("plugins/codepm/.codex-plugin/plugin.json")
    ) as Record<string, unknown>;
    const appConnectorDocs = readText("docs/app-connector.md");

    expect(manifest).not.toHaveProperty("apps");
    expect(existsSync("plugins/codepm/.app.json")).toBe(false);
    expect(appConnectorDocs).toContain("supportsExecutionMutation: false");
    expect(appConnectorDocs).toContain("MCP tools are review-only");
    expect(appConnectorDocs).toContain("codepm execute-action");
    expect(appConnectorDocs).toContain("Actual app connector creation and registration remain future work");
  });
});

interface FetchCall {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

function createGitHubFetch(
  calls: FetchCall[],
  state: GitHubPullRequestState
): GitHubRestFetch {
  return async (url, init) => {
    calls.push({ url, init });

    if (url === `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}`) {
      return response({
        title: state.title,
        body: state.body,
        base: { ref: state.baseRef },
        head: { ref: state.headRef, sha: state.headSha },
        draft: state.mergeability.isDraft,
        mergeable: state.mergeability.canMerge,
        mergeable_state: state.mergeability.canMerge ? "clean" : "blocked"
      });
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}/files?per_page=100`
    ) {
      return response(state.changedFiles.map((filename) => ({ filename })));
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/pulls/${state.prNumber}/reviews?per_page=100`
    ) {
      return response(
        state.reviews.map((review) => ({
          user: { login: review.reviewer },
          state: review.state.toUpperCase(),
          submitted_at: review.submittedAt
        }))
      );
    }

    if (
      url ===
      `${apiBaseUrl}/repos/octo/example/commits/${state.headSha}/check-runs?per_page=100`
    ) {
      return response({
        check_runs: state.checks.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          details_url: check.detailsUrl,
          completed_at: check.completedAt
        }))
      });
    }

    if (
      url === `${apiBaseUrl}/repos/octo/example/commits/${state.headSha}/status`
    ) {
      return response({ statuses: [] });
    }

    if (url === `${apiBaseUrl}/graphql`) {
      return response({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: []
              }
            }
          }
        }
      });
    }

    return response({ message: `Unexpected URL ${url}` }, { status: 500 });
  };
}

function response(
  value: unknown,
  options: { status?: number } = {}
): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
} {
  const status = options.status ?? 200;

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return null;
      }
    },
    async text() {
      return JSON.stringify(value);
    }
  };
}
