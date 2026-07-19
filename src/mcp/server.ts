import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  CODEPM_MCP_TOOL_NAMES,
  getCodePmMcpCapabilities,
  runReviewDiffTool,
  runReviewPrFixtureTool,
  runReviewPrGitHubTool,
  runReviewProposalTool,
  toCapabilitiesToolResult,
  toReviewToolResult
} from "./tools.js";

const checkRunSchema = z.object({
  name: z.string(),
  status: z.enum(["queued", "in_progress", "completed"]),
  conclusion: z
    .enum([
      "success",
      "failure",
      "neutral",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required"
    ])
    .optional(),
  detailsUrl: z.string().optional(),
  completedAt: z.string().optional()
});

const reviewSchema = z.object({
  reviewer: z.string(),
  state: z.enum([
    "approved",
    "changes_requested",
    "commented",
    "dismissed",
    "pending"
  ]),
  submittedAt: z.string().optional()
});

const reviewThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number().int().optional(),
  isResolved: z.boolean(),
  summary: z.string().optional()
});

const prStateSchema = z.object({
  repo: z.string(),
  prNumber: z.number().int(),
  title: z.string(),
  body: z.string(),
  baseRef: z.string(),
  headRef: z.string(),
  headSha: z.string(),
  changedFiles: z.array(z.string()),
  checks: z.array(checkRunSchema),
  reviews: z.array(reviewSchema),
  reviewThreads: z.array(reviewThreadSchema),
  unresolvedThreads: z.array(reviewThreadSchema),
  mergeability: z.object({
    state: z.enum(["mergeable", "blocked", "conflicting", "unknown"]),
    isDraft: z.boolean(),
    canMerge: z.boolean(),
    reason: z.string().optional()
  }),
  readAt: z.string()
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const externalReadOnlyAnnotations = {
  ...readOnlyAnnotations,
  openWorldHint: true
} as const;

export function createCodePmMcpServer(): McpServer {
  const server = new McpServer({
    name: "codepm",
    version: "0.0.0"
  });

  server.registerTool(
    CODEPM_MCP_TOOL_NAMES[0],
    {
      title: "Review CodePM Proposal",
      description:
        "Review a Claude work proposal with the CodePM plan review engine.",
      inputSchema: {
        proposalMarkdown: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async ({ proposalMarkdown }) =>
      toReviewToolResult(runReviewProposalTool({ proposalMarkdown }))
  );

  server.registerTool(
    CODEPM_MCP_TOOL_NAMES[1],
    {
      title: "Review PR Fixture",
      description:
        "Review fixture-provided GitHub pull request state with the CodePM PR gate.",
      inputSchema: {
        proposalMarkdown: z.string().min(1),
        prState: prStateSchema,
        expectedHeadSha: z.string().optional(),
        requiredCheckNames: z.array(z.string()).optional()
      },
      annotations: readOnlyAnnotations
    },
    async ({
      proposalMarkdown,
      prState,
      expectedHeadSha,
      requiredCheckNames
    }) =>
      toReviewToolResult(
        await runReviewPrFixtureTool({
          proposalMarkdown,
          prState,
          expectedHeadSha,
          requiredCheckNames
        })
      )
  );

  server.registerTool(
    CODEPM_MCP_TOOL_NAMES[2],
    {
      title: "Review GitHub PR",
      description:
        "Review live read-only GitHub pull request state with the CodePM PR gate.",
      inputSchema: {
        proposalMarkdown: z.string().min(1),
        repo: z.string().min(1),
        prNumber: z.number().int().positive(),
        expectedHeadSha: z.string().min(1).optional(),
        requiredCheckNames: z.array(z.string().min(1)).optional(),
        tokenEnv: z.string().min(1).optional(),
        apiBaseUrl: z.string().min(1).optional(),
        apiVersion: z.string().min(1).optional()
      },
      annotations: externalReadOnlyAnnotations
    },
    async ({
      proposalMarkdown,
      repo,
      prNumber,
      expectedHeadSha,
      requiredCheckNames,
      tokenEnv,
      apiBaseUrl,
      apiVersion
    }) =>
      toReviewToolResult(
        await runReviewPrGitHubTool({
          proposalMarkdown,
          repo,
          prNumber,
          expectedHeadSha,
          requiredCheckNames,
          tokenEnv,
          apiBaseUrl,
          apiVersion
        })
      )
  );

  server.registerTool(
    CODEPM_MCP_TOOL_NAMES[3],
    {
      title: "Review Local Diff",
      description:
        "Review local git changes with CodePM after enforcing CODEPM_MCP_ALLOWED_ROOTS.",
      inputSchema: {
        proposalMarkdown: z.string().min(1),
        cwd: z.string().min(1),
        baseRef: z.string().min(1).optional(),
        configPath: z.string().min(1).optional()
      },
      annotations: readOnlyAnnotations
    },
    async ({ proposalMarkdown, cwd, baseRef, configPath }) =>
      toReviewToolResult(
        runReviewDiffTool({ proposalMarkdown, cwd, baseRef, configPath })
      )
  );

  server.registerTool(
    CODEPM_MCP_TOOL_NAMES[4],
    {
      title: "CodePM Capabilities",
      description:
        "Describe the review-only CodePM MCP connector capabilities and safety boundaries.",
      annotations: readOnlyAnnotations
    },
    async () => toCapabilitiesToolResult(getCodePmMcpCapabilities())
  );

  return server;
}

export async function runCodePmMcpServer(): Promise<void> {
  const server = createCodePmMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
