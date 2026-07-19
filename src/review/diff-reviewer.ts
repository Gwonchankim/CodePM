import type { Decision, Proposal } from "../domain/types.js";
import type { GitState } from "../integrations/git/git-types.js";
import { scanSecrets } from "../policy/secret-scanner.js";
import { findSensitivePathMatches } from "../policy/sensitive-paths.js";
import { buildDecision } from "./decision-builder.js";

export interface DiffReviewInput {
  proposal: Proposal;
  gitState: GitState;
  maxChangedFiles?: number;
  additionalSensitivePaths?: string[];
}

const DEFAULT_MAX_CHANGED_FILES = 12;

export function reviewDiff(input: DiffReviewInput): Decision {
  const maxChangedFiles = input.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  const changedFiles = input.gitState.changedFiles.map(normalizePath);
  const expectedFiles = input.proposal.filesExpectedToChange.map(normalizePath);
  const unexpectedFiles = changedFiles.filter(
    (file) => !matchesExpectedFile(file, expectedFiles)
  );
  const sensitivePathMatches = findSensitivePathMatches(changedFiles, {
    additionalSensitivePaths: input.additionalSensitivePaths
  });
  const secretScan = scanSecrets({
    text: input.gitState.diffText,
    paths: changedFiles
  });
  const broadChange = changedFiles.length > maxChangedFiles;

  if (sensitivePathMatches.length > 0) {
    return buildDecision({
      decision: "block",
      summary: "The implementation diff changes sensitive files and cannot proceed.",
      requiredChanges: sensitivePathMatches.map(
        (match) =>
          `Remove sensitive file change or provide explicit human approval and an updated proposal: ${match.path}.`
      ),
      risks: [
        ...sensitivePathMatches.map(
          (match) => `Sensitive path changed: ${match.path} (${match.reason})`
        ),
        ...unexpectedFiles.map(
          (file) => `Actual diff includes file outside proposal scope: ${file}`
        )
      ],
      verificationRequired: [
        "Re-run implementation review after sensitive path changes are removed or explicitly approved."
      ],
      approvedActions: ["Revise the implementation diff."],
      blockedActions: [
        "Do not push the branch.",
        "Do not create a PR.",
        "Do not merge the PR."
      ]
    });
  }

  if (!secretScan.ok) {
    return buildDecision({
      decision: "block",
      summary: "The implementation diff contains secret-like values.",
      requiredChanges: secretScan.findings.map(
        (finding) =>
          `Remove the secret-like value from ${finding.path} and rotate it if it was real.`
      ),
      risks: [
        ...secretScan.findings.map((finding) => finding.message),
        ...unexpectedFiles.map(
          (file) => `Actual diff includes file outside proposal scope: ${file}`
        )
      ],
      verificationRequired: [
        "Remove the secret-like values and re-run implementation review.",
        "Rotate any credential that may have been exposed."
      ],
      approvedActions: ["Revise the implementation diff."],
      blockedActions: [
        "Do not push the branch.",
        "Do not create a PR.",
        "Do not merge the PR."
      ]
    });
  }

  const requiredChanges = [
    ...unexpectedFiles.map(
      (file) => `Remove or justify unexpected file change: ${file}.`
    )
  ];

  if (broadChange) {
    requiredChanges.push(
      `Reduce the diff scope or update the proposal for a broad change set: ${changedFiles.length} files changed, limit is ${maxChangedFiles}.`
    );
  }

  if (requiredChanges.length > 0) {
    return buildDecision({
      decision: "request_changes",
      summary: "The implementation diff needs scope corrections before approval.",
      requiredChanges,
      risks: unexpectedFiles.map(
        (file) => `Actual diff includes file outside proposal scope: ${file}`
      ),
      verificationRequired: [
        "Update the proposal or implementation so the changed files match the approved scope."
      ],
      approvedActions: ["Revise the implementation diff."],
      blockedActions: [
        "Do not push, create a PR, or merge until diff scope is corrected."
      ]
    });
  }

  return buildDecision({
    decision: "approve",
    summary: "The implementation diff matches the approved proposal scope.",
    verificationRequired: [
      input.proposal.testPlan,
      "Run secret scan before push, PR creation, or merge."
    ],
    approvedActions: ["Proceed to secret scan."],
    blockedActions: [
      "Do not push, create a PR, or merge until secret scan and final PM gate pass."
    ]
  });
}

function matchesExpectedFile(path: string, expectedFiles: string[]): boolean {
  return expectedFiles.some((expectedPath) => {
    if (expectedPath.endsWith("/")) {
      return path.startsWith(expectedPath);
    }

    return path === expectedPath;
  });
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}
