export const CODEPM_CONFIG_SCHEMA_VERSION = "codepm.config.v1";

export type CodePmConfigSchemaVersion = typeof CODEPM_CONFIG_SCHEMA_VERSION;
export type CodePmGitHubAdapterMode = "fixture";
export type CodePmGitHubPrReadAdapterMode = "fixture" | "github";

export interface CodePmConfigDefaults {
  baseRef: string;
  auditLogPath: string;
}

export interface CodePmReviewConfig {
  maxChangedFiles: number;
  additionalSensitivePaths: string[];
}

export interface CodePmGitHubConfig {
  adapterMode: CodePmGitHubAdapterMode;
  prReadAdapterMode: CodePmGitHubPrReadAdapterMode;
  prReadTokenEnv: string;
  prReadApiBaseUrl: string;
  prReadApiVersion: string;
}

export interface CodePmSafetyConfig {
  secretScanning: true;
  highRiskHumanApproval: true;
}

export interface CodePmConfig {
  schemaVersion: CodePmConfigSchemaVersion;
  defaults: CodePmConfigDefaults;
  review: CodePmReviewConfig;
  github: CodePmGitHubConfig;
  safety: CodePmSafetyConfig;
}

export const DEFAULT_CODEPM_CONFIG: CodePmConfig = {
  schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
  defaults: {
    baseRef: "main",
    auditLogPath: ".codepm/audit.jsonl"
  },
  review: {
    maxChangedFiles: 12,
    additionalSensitivePaths: []
  },
  github: {
    adapterMode: "fixture",
    prReadAdapterMode: "fixture",
    prReadTokenEnv: "GITHUB_TOKEN",
    prReadApiBaseUrl: "https://api.github.com",
    prReadApiVersion: "2022-11-28"
  },
  safety: {
    secretScanning: true,
    highRiskHumanApproval: true
  }
};
