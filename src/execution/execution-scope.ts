import { normalizeApprovalFiles } from "../policy/approval-evidence.js";

export interface ExecutionScope {
  repo?: string;
  remote?: string;
  branch?: string;
  prNumber?: number;
  expectedHeadSha?: string;
  forcePush?: boolean;
  filesChanged: string[];
}

export type ExecutionScopeMismatchField =
  | "repo"
  | "remote"
  | "branch"
  | "prNumber"
  | "expectedHeadSha"
  | "forcePush"
  | "filesChanged";

export interface ExecutionScopeMismatch {
  field: ExecutionScopeMismatchField;
  message: string;
}

export function compareExecutionScopes(
  reviewedScope: ExecutionScope,
  currentScope: ExecutionScope
): ExecutionScopeMismatch[] {
  const mismatches: ExecutionScopeMismatch[] = [];

  compareScopeField(mismatches, "repo", reviewedScope.repo, currentScope.repo);
  compareScopeField(
    mismatches,
    "remote",
    reviewedScope.remote,
    currentScope.remote
  );
  compareScopeField(
    mismatches,
    "branch",
    reviewedScope.branch,
    currentScope.branch
  );
  compareScopeField(
    mismatches,
    "prNumber",
    reviewedScope.prNumber,
    currentScope.prNumber
  );
  compareScopeField(
    mismatches,
    "expectedHeadSha",
    reviewedScope.expectedHeadSha,
    currentScope.expectedHeadSha
  );
  compareScopeField(
    mismatches,
    "forcePush",
    reviewedScope.forcePush,
    currentScope.forcePush
  );

  const reviewedFiles = normalizeApprovalFiles(reviewedScope.filesChanged);
  const currentFiles = normalizeApprovalFiles(currentScope.filesChanged);

  if (reviewedFiles.join("\n") !== currentFiles.join("\n")) {
    mismatches.push({
      field: "filesChanged",
      message: "Fresh changed files no longer match the reviewed scope."
    });
  }

  return mismatches;
}

function compareScopeField(
  mismatches: ExecutionScopeMismatch[],
  field: Exclude<ExecutionScopeMismatchField, "filesChanged">,
  reviewedValue: string | number | boolean | undefined,
  currentValue: string | number | boolean | undefined
): void {
  if (reviewedValue !== currentValue) {
    mismatches.push({
      field,
      message: `Fresh ${field} no longer matches reviewed scope: reviewed ${formatValue(reviewedValue)}, current ${formatValue(currentValue)}.`
    });
  }
}

function formatValue(value: string | number | boolean | undefined): string {
  return value === undefined ? "undefined" : String(value);
}
