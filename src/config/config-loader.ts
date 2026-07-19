import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CODEPM_CONFIG_SCHEMA_VERSION,
  DEFAULT_CODEPM_CONFIG,
  type CodePmConfig,
  type CodePmGitHubAdapterMode,
  type CodePmGitHubPrReadAdapterMode
} from "./config-schema.js";

export type CodePmConfigValidationErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "invalid_schema_version"
  | "invalid_field"
  | "unsupported_value"
  | "unsafe_override";

export interface CodePmConfigValidationError {
  code: CodePmConfigValidationErrorCode;
  path: string;
  message: string;
}

export interface LoadCodePmConfigOptions {
  cwd?: string;
  configPath?: string;
}

export type LoadCodePmConfigResult =
  | {
      ok: true;
      config: CodePmConfig;
      configPath: string | null;
    }
  | {
      ok: false;
      configPath: string;
      errors: CodePmConfigValidationError[];
    };

export function loadCodePmConfig(
  options: LoadCodePmConfigOptions = {}
): LoadCodePmConfigResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = resolve(options.configPath ?? join(cwd, "codepm.config.json"));

  if (!options.configPath && !existsSync(configPath)) {
    return {
      ok: true,
      config: DEFAULT_CODEPM_CONFIG,
      configPath: null
    };
  }

  let value: unknown;

  try {
    value = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch (error) {
    return {
      ok: false,
      configPath,
      errors: [
        {
          code: "invalid_json",
          path: "codepm.config.json",
          message: `Could not read or parse config JSON: ${getErrorMessage(error)}`
        }
      ]
    };
  }

  const parsed = parseCodePmConfig(value);

  if (!parsed.ok) {
    return {
      ok: false,
      configPath,
      errors: parsed.errors
    };
  }

  return {
    ok: true,
    configPath,
    config: parsed.config
  };
}

export function parseCodePmConfig(
  value: unknown
): { ok: true; config: CodePmConfig } | { ok: false; errors: CodePmConfigValidationError[] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_shape",
          path: "codepm.config.json",
          message: "CodePM config must be a JSON object."
        }
      ]
    };
  }

  const errors: CodePmConfigValidationError[] = [];

  if (value.schemaVersion !== CODEPM_CONFIG_SCHEMA_VERSION) {
    errors.push({
      code: "invalid_schema_version",
      path: "schemaVersion",
      message: `Expected schemaVersion ${CODEPM_CONFIG_SCHEMA_VERSION}.`
    });
  }

  const defaults = parseDefaultsConfig(value.defaults, errors);
  const review = parseReviewConfig(value.review, errors);
  const github = parseGitHubConfig(value.github, errors);
  const safety = parseSafetyConfig(value.safety, errors);

  if (errors.length > 0) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    config: {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      defaults,
      review,
      github,
      safety
    }
  };
}

function parseDefaultsConfig(
  value: unknown,
  errors: CodePmConfigValidationError[]
): CodePmConfig["defaults"] {
  const defaults = { ...DEFAULT_CODEPM_CONFIG.defaults };

  if (value === undefined) {
    return defaults;
  }

  if (!isRecord(value)) {
    errors.push({
      code: "invalid_field",
      path: "defaults",
      message: "defaults must be an object."
    });
    return defaults;
  }

  if (value.baseRef !== undefined) {
    if (isNonEmptyString(value.baseRef)) {
      defaults.baseRef = value.baseRef;
    } else {
      errors.push({
        code: "invalid_field",
        path: "defaults.baseRef",
        message: "defaults.baseRef must be a non-empty string."
      });
    }
  }

  if (value.auditLogPath !== undefined) {
    if (isNonEmptyString(value.auditLogPath)) {
      defaults.auditLogPath = value.auditLogPath;
    } else {
      errors.push({
        code: "invalid_field",
        path: "defaults.auditLogPath",
        message: "defaults.auditLogPath must be a non-empty string."
      });
    }
  }

  return defaults;
}

function parseReviewConfig(
  value: unknown,
  errors: CodePmConfigValidationError[]
): CodePmConfig["review"] {
  const review = {
    maxChangedFiles: DEFAULT_CODEPM_CONFIG.review.maxChangedFiles,
    additionalSensitivePaths: [
      ...DEFAULT_CODEPM_CONFIG.review.additionalSensitivePaths
    ]
  };

  if (value === undefined) {
    return review;
  }

  if (!isRecord(value)) {
    errors.push({
      code: "invalid_field",
      path: "review",
      message: "review must be an object."
    });
    return review;
  }

  if (value.maxChangedFiles !== undefined) {
    if (isPositiveInteger(value.maxChangedFiles)) {
      review.maxChangedFiles = value.maxChangedFiles;
    } else {
      errors.push({
        code: "invalid_field",
        path: "review.maxChangedFiles",
        message: "review.maxChangedFiles must be a positive integer."
      });
    }
  }

  if (value.additionalSensitivePaths !== undefined) {
    if (!Array.isArray(value.additionalSensitivePaths)) {
      errors.push({
        code: "invalid_field",
        path: "review.additionalSensitivePaths",
        message: "review.additionalSensitivePaths must be an array of strings."
      });
    } else {
      review.additionalSensitivePaths = value.additionalSensitivePaths.flatMap(
        (pattern, index) => {
          if (isNonEmptyString(pattern)) {
            return [pattern];
          }

          errors.push({
            code: "invalid_field",
            path: `review.additionalSensitivePaths[${index}]`,
            message:
              "review.additionalSensitivePaths entries must be non-empty strings."
          });
          return [];
        }
      );
    }
  }

  return review;
}

function parseGitHubConfig(
  value: unknown,
  errors: CodePmConfigValidationError[]
): CodePmConfig["github"] {
  const github = { ...DEFAULT_CODEPM_CONFIG.github };

  if (value === undefined) {
    return github;
  }

  if (!isRecord(value)) {
    errors.push({
      code: "invalid_field",
      path: "github",
      message: "github must be an object."
    });
    return github;
  }

  if (value.adapterMode !== undefined) {
    if (isGitHubAdapterMode(value.adapterMode)) {
      github.adapterMode = value.adapterMode;
    } else {
      errors.push({
        code: "unsupported_value",
        path: "github.adapterMode",
        message: "github.adapterMode currently supports only fixture."
      });
    }
  }

  if (value.prReadAdapterMode !== undefined) {
    if (isGitHubPrReadAdapterMode(value.prReadAdapterMode)) {
      github.prReadAdapterMode = value.prReadAdapterMode;
    } else {
      errors.push({
        code: "unsupported_value",
        path: "github.prReadAdapterMode",
        message:
          "github.prReadAdapterMode must be fixture or github for read-only PR review."
      });
    }
  }

  if (value.prReadTokenEnv !== undefined) {
    if (isNonEmptyString(value.prReadTokenEnv)) {
      github.prReadTokenEnv = value.prReadTokenEnv;
    } else {
      errors.push({
        code: "invalid_field",
        path: "github.prReadTokenEnv",
        message: "github.prReadTokenEnv must be a non-empty string."
      });
    }
  }

  if (value.prReadApiBaseUrl !== undefined) {
    if (isNonEmptyString(value.prReadApiBaseUrl)) {
      github.prReadApiBaseUrl = value.prReadApiBaseUrl;
    } else {
      errors.push({
        code: "invalid_field",
        path: "github.prReadApiBaseUrl",
        message: "github.prReadApiBaseUrl must be a non-empty string."
      });
    }
  }

  if (value.prReadApiVersion !== undefined) {
    if (isNonEmptyString(value.prReadApiVersion)) {
      github.prReadApiVersion = value.prReadApiVersion;
    } else {
      errors.push({
        code: "invalid_field",
        path: "github.prReadApiVersion",
        message: "github.prReadApiVersion must be a non-empty string."
      });
    }
  }

  return github;
}

function parseSafetyConfig(
  value: unknown,
  errors: CodePmConfigValidationError[]
): CodePmConfig["safety"] {
  if (value === undefined) {
    return DEFAULT_CODEPM_CONFIG.safety;
  }

  if (!isRecord(value)) {
    errors.push({
      code: "invalid_field",
      path: "safety",
      message: "safety must be an object."
    });
    return DEFAULT_CODEPM_CONFIG.safety;
  }

  if (value.secretScanning !== undefined && value.secretScanning !== true) {
    errors.push({
      code: "unsafe_override",
      path: "safety.secretScanning",
      message: "Project config cannot disable secret scanning."
    });
  }

  if (
    value.highRiskHumanApproval !== undefined &&
    value.highRiskHumanApproval !== true
  ) {
    errors.push({
      code: "unsafe_override",
      path: "safety.highRiskHumanApproval",
      message: "Project config cannot disable high-risk human approval."
    });
  }

  return DEFAULT_CODEPM_CONFIG.safety;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isGitHubAdapterMode(value: unknown): value is CodePmGitHubAdapterMode {
  return value === "fixture";
}

function isGitHubPrReadAdapterMode(
  value: unknown
): value is CodePmGitHubPrReadAdapterMode {
  return value === "fixture" || value === "github";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
