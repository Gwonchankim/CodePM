import { describe, expect, it } from "vitest";

import { redactSecrets } from "../../../../src/policy/redaction.js";
import { scanSecrets } from "../../../../src/policy/secret-scanner.js";

const fakeApiKey = "sk-test-fake-1234567890abcdef1234567890";
const fakeGithubToken = "synthetic-test-secret-token";
const fakeDatabaseUrl = "postgres://user:pass123456@localhost:5432/app";
const fakePrivateKeyBlock = [
  "-----BEGIN PRIVATE KEY-----",
  "fake-private-key-body",
  "-----END PRIVATE KEY-----"
].join("\n");

describe("redactSecrets", () => {
  it("redacts credential-like values without changing surrounding context", () => {
    const redacted = redactSecrets(
      `OPENAI_API_KEY=${fakeApiKey}\nDATABASE_URL=${fakeDatabaseUrl}`
    );

    expect(redacted).toContain("OPENAI_API_KEY=***REDACTED***");
    expect(redacted).toContain("DATABASE_URL=***REDACTED***");
    expect(redacted).not.toContain(fakeApiKey);
    expect(redacted).not.toContain(fakeDatabaseUrl);
  });
});

describe("scanSecrets", () => {
  it("detects API keys, tokens, database URLs, and private keys without returning raw secrets", () => {
    const result = scanSecrets({
      text: [
        "diff --git a/src/config.ts b/src/config.ts",
        "+++ b/src/config.ts",
        `+OPENAI_API_KEY=${fakeApiKey}`,
        `+GITHUB_TOKEN=${fakeGithubToken}`,
        `+DATABASE_URL=${fakeDatabaseUrl}`,
        `+${fakePrivateKeyBlock}`
      ].join("\n")
    });
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        "api_key",
        "token",
        "database_url",
        "private_key"
      ])
    );
    expect(result.findings.every((finding) => finding.path === "src/config.ts")).toBe(
      true
    );
    expect(serialized).not.toContain(fakeApiKey);
    expect(serialized).not.toContain(fakeGithubToken);
    expect(serialized).not.toContain(fakeDatabaseUrl);
    expect(serialized).not.toContain(fakePrivateKeyBlock);
  });

  it("flags environment and production config paths as sensitive findings", () => {
    const result = scanSecrets({
      text: "diff --git a/.env.production b/.env.production\n+++ b/.env.production\n+SAFE_PLACEHOLDER=value",
      paths: [".env.production", "src/review/diff-reviewer.ts"]
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: "sensitive_path",
        path: ".env.production"
      })
    );
  });

  it("returns ok for ordinary implementation diffs", () => {
    const result = scanSecrets({
      text: "diff --git a/src/review/diff-reviewer.ts b/src/review/diff-reviewer.ts\n+++ b/src/review/diff-reviewer.ts\n+export const ok = true;",
      paths: ["src/review/diff-reviewer.ts"]
    });

    expect(result).toEqual({
      ok: true,
      findings: [],
      redactedText:
        "diff --git a/src/review/diff-reviewer.ts b/src/review/diff-reviewer.ts\n+++ b/src/review/diff-reviewer.ts\n+export const ok = true;"
    });
  });
});
