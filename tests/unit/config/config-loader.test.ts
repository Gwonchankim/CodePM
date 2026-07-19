import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEPM_CONFIG_SCHEMA_VERSION,
  DEFAULT_CODEPM_CONFIG
} from "../../../src/config/config-schema.js";
import { loadCodePmConfig } from "../../../src/config/config-loader.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-config-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(cwd: string, value: unknown): string {
  const path = join(cwd, "codepm.config.json");
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("loadCodePmConfig", () => {
  it("loads the documented example config", () => {
    const configPath = join(
      process.cwd(),
      "docs",
      "examples",
      "codepm.config.json"
    );

    const result = loadCodePmConfig({ configPath });

    expect(result).toEqual({
      ok: true,
      configPath,
      config: {
        schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
        defaults: {
          baseRef: "main",
          auditLogPath: ".codepm/audit.jsonl"
        },
        review: {
          maxChangedFiles: 12,
          additionalSensitivePaths: [
            "infra/prod/**",
            ".github/workflows/**"
          ]
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
      }
    });
  });

  it("returns secure defaults when codepm.config.json is missing", () => {
    const cwd = makeTempDir();

    const result = loadCodePmConfig({ cwd });

    expect(result).toEqual({
      ok: true,
      config: DEFAULT_CODEPM_CONFIG,
      configPath: null
    });
  });

  it("merges safe project overrides into defaults", () => {
    const cwd = makeTempDir();
    const configPath = writeConfig(cwd, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      defaults: {
        baseRef: "develop",
        auditLogPath: ".audit/codepm.jsonl"
      },
      review: {
        maxChangedFiles: 24,
        additionalSensitivePaths: ["infra/prod/**", "secrets/**"]
      },
      github: {
        adapterMode: "fixture",
        prReadAdapterMode: "github",
        prReadTokenEnv: "CODEPM_GITHUB_TOKEN",
        prReadApiBaseUrl: "https://github.enterprise.test/api/v3",
        prReadApiVersion: "2023-01-01"
      }
    });

    const result = loadCodePmConfig({ cwd });

    expect(result).toEqual({
      ok: true,
      configPath,
      config: {
        schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
        defaults: {
          baseRef: "develop",
          auditLogPath: ".audit/codepm.jsonl"
        },
        review: {
          maxChangedFiles: 24,
          additionalSensitivePaths: ["infra/prod/**", "secrets/**"]
        },
        github: {
          adapterMode: "fixture",
          prReadAdapterMode: "github",
          prReadTokenEnv: "CODEPM_GITHUB_TOKEN",
          prReadApiBaseUrl: "https://github.enterprise.test/api/v3",
          prReadApiVersion: "2023-01-01"
        },
        safety: {
          secretScanning: true,
          highRiskHumanApproval: true
        }
      }
    });
  });

  it("rejects attempts to disable secret scanning or high-risk approval", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, {
      schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
      safety: {
        secretScanning: false,
        highRiskHumanApproval: false
      }
    });

    const result = loadCodePmConfig({ cwd });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unsafe_override",
            path: "safety.secretScanning",
            message: expect.stringContaining("cannot disable secret scanning")
          }),
          expect.objectContaining({
            code: "unsafe_override",
            path: "safety.highRiskHumanApproval",
            message: expect.stringContaining(
              "cannot disable high-risk human approval"
            )
          })
        ])
      );
    }
  });

  it("returns actionable validation errors for invalid config values", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, {
      schemaVersion: "codepm.config.v0",
      defaults: {
        baseRef: "",
        auditLogPath: 123
      },
      review: {
        maxChangedFiles: 0,
        additionalSensitivePaths: ["infra/**", 7]
      },
      github: {
        adapterMode: "real-network",
        prReadAdapterMode: "live",
        prReadTokenEnv: "",
        prReadApiBaseUrl: "",
        prReadApiVersion: ""
      }
    });

    const result = loadCodePmConfig({ cwd });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid_schema_version",
            path: "schemaVersion"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "defaults.baseRef"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "defaults.auditLogPath"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "review.maxChangedFiles"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "review.additionalSensitivePaths[1]"
          }),
          expect.objectContaining({
            code: "unsupported_value",
            path: "github.adapterMode"
          }),
          expect.objectContaining({
            code: "unsupported_value",
            path: "github.prReadAdapterMode"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "github.prReadTokenEnv"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "github.prReadApiBaseUrl"
          }),
          expect.objectContaining({
            code: "invalid_field",
            path: "github.prReadApiVersion"
          })
        ])
      );
    }
  });

  it("loads from an explicit config path", () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, "nested");
    mkdirSync(configDir);
    const configPath = join(configDir, "custom-codepm.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: CODEPM_CONFIG_SCHEMA_VERSION,
        review: { maxChangedFiles: 8 }
      }),
      "utf8"
    );

    const result = loadCodePmConfig({ cwd, configPath });

    expect(result).toEqual({
      ok: true,
      configPath,
      config: {
        ...DEFAULT_CODEPM_CONFIG,
        review: {
          maxChangedFiles: 8,
          additionalSensitivePaths: []
        }
      }
    });
  });
});
