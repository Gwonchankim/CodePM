#!/usr/bin/env node
import { runCodePmMcpServer } from "./server.js";

export const MCP_HELP_TEXT = `CodePM MCP server

Usage:
  codepm-mcp [--help]

Starts a local stdio MCP server exposing review-only CodePM tools:
  codepm_review_proposal
  codepm_review_pr_fixture
  codepm_review_pr_github
  codepm_review_diff
  codepm_capabilities

Execution mutations, git push, GitHub mutation, and Browser fallback are not exposed.
Local diff review requires cwd access through CODEPM_MCP_ALLOWED_ROOTS.
GitHub PR review may perform external read-only GitHub API requests using a token env var.
`;

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(MCP_HELP_TEXT);
    return;
  }

  await runCodePmMcpServer();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CodePM MCP server failed: ${message}`);
  process.exitCode = 1;
});
