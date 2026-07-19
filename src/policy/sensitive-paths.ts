export interface SensitivePathMatch {
  path: string;
  reason: string;
}

interface SensitivePathRule {
  reason: string;
  pattern: RegExp;
}

export interface SensitivePathMatchOptions {
  additionalSensitivePaths?: string[];
}

const SENSITIVE_PATH_RULES: SensitivePathRule[] = [
  {
    reason: "environment or secret-bearing file",
    pattern: /(^|\/)\.env(?:\.|$)/i
  },
  {
    reason: "private key or certificate material",
    pattern: /\.(?:pem|key|p12|pfx|crt)$/i
  },
  {
    reason: "CI/CD workflow configuration",
    pattern: /^\.github\/workflows\//i
  },
  {
    reason: "database migration or SQL change",
    pattern: /(^migrations\/|\.sql$)/i
  },
  {
    reason: "authentication or authorization code",
    pattern: /(^|\/)(?:auth|authentication|authorization|session|oauth)(?:\/|\.|-)/i
  },
  {
    reason: "billing or payment code",
    pattern: /(^|\/)(?:billing|payment|checkout|invoice)(?:\/|\.|-)/i
  },
  {
    reason: "production deployment configuration",
    pattern: /(^|\/)(?:deploy|deployment|production|prod)(?:\/|\.|-)/i
  }
];

const PROJECT_CONFIGURED_SENSITIVE_PATH_REASON =
  "project configured sensitive path";

export function findSensitivePathMatches(
  paths: string[],
  options: SensitivePathMatchOptions = {}
): SensitivePathMatch[] {
  const configuredRules = (options.additionalSensitivePaths ?? []).map(
    (pattern) => ({
      reason: PROJECT_CONFIGURED_SENSITIVE_PATH_REASON,
      pattern: globPatternToRegExp(pattern)
    })
  );
  const rules = [...configuredRules, ...SENSITIVE_PATH_RULES];

  return paths.flatMap((path) => {
    const normalizedPath = normalizePath(path);
    const rule = rules.find((candidate) =>
      candidate.pattern.test(normalizedPath)
    );

    if (!rule) {
      return [];
    }

    return [
      {
        path: normalizedPath,
        reason: rule.reason
      }
    ];
  });
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizePath(pattern);
  let source = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`${source}$`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
