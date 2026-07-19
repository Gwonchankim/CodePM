import type {
  GitHubPullRequestLocator,
  GitHubPullRequestReadResult,
  GitHubPullRequestState
} from "./github-types.js";

export interface GitHubReadAdapter {
  readPullRequest(
    locator: GitHubPullRequestLocator
  ): Promise<GitHubPullRequestReadResult>;
}

export function createFixtureGitHubReadAdapter(
  states: GitHubPullRequestState[]
): GitHubReadAdapter {
  const statesByKey = new Map(
    states.map((state) => [toStateKey(state.repo, state.prNumber), state])
  );

  return {
    async readPullRequest(locator) {
      const state = statesByKey.get(toStateKey(locator.repo, locator.prNumber));

      if (!state) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message: `GitHub PR state not found for ${locator.repo}#${locator.prNumber}`
          }
        };
      }

      return {
        ok: true,
        state
      };
    }
  };
}

function toStateKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}
