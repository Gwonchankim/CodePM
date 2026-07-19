#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runFeedbackForClaudeCommand } from "./commands/feedback-for-claude.js";
import {
  runExecuteActionCommand,
  runExecuteActionCommandAsync
} from "./commands/execute-action.js";
import { runReviewClaudeOutputCommand } from "./commands/review-claude-output.js";
import { runReviewDiffCommand } from "./commands/review-diff.js";
import { runReviewPlanCommand } from "./commands/review-plan.js";
import {
  runReviewPrCommand,
  runReviewPrCommandAsync
} from "./commands/review-pr.js";

export const VERSION = "0.0.0";

export function getHelpText(): string {
  return [
    "CodePM - local PM gate for Claude Code and Codex workflows",
    "",
    "Usage: codepm <command> [options]",
    "",
    "Commands:",
    "  review-plan <proposal.md>       Review a Claude work proposal",
    "  review-diff --proposal <file>   Review local implementation changes",
    "  review-claude-output <file>     Review captured Claude CLI output",
    "  feedback-for-claude --decision <file>",
    "                                  Print Claude-facing PM feedback",
    "  review-pr --repo <repo> --pr <n>",
    "                                  Review GitHub PR readiness",
    "  execute-action                  Execute one approved scoped action",
    "",
    "Options:",
    "  -h, --help       Show this help message",
    "  -v, --version    Show the CodePM version"
  ].join("\n");
}

export function runCli(
  args: string[] = process.argv.slice(2),
  output: (text: string) => void = console.log
): number {
  const [command, ...commandArgs] = args;

  if (!command || command === "--help" || command === "-h") {
    output(getHelpText());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    output(VERSION);
    return 0;
  }

  if (command === "review-plan") {
    const result = runReviewPlanCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "review-diff") {
    const result = runReviewDiffCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "feedback-for-claude") {
    const result = runFeedbackForClaudeCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "review-claude-output") {
    const result = runReviewClaudeOutputCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "review-pr") {
    const result = runReviewPrCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "execute-action") {
    const result = runExecuteActionCommand(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  output(`Unknown command: ${command}\n\n${getHelpText()}`);
  return 1;
}

export async function runCliAsync(
  args: string[] = process.argv.slice(2),
  output: (text: string) => void = console.log
): Promise<number> {
  const [command, ...commandArgs] = args;

  if (command === "review-pr") {
    const result = await runReviewPrCommandAsync(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  if (command === "execute-action") {
    const result = await runExecuteActionCommandAsync(commandArgs);
    output(result.output);
    return result.exitCode;
  }

  return runCli(args, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCliAsync();
}
