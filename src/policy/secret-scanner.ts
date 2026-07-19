import { findSensitivePathMatches } from "./sensitive-paths.js";
import { redactSecrets } from "./redaction.js";

export type SecretFindingKind =
  | "api_key"
  | "token"
  | "private_key"
  | "database_url"
  | "sensitive_path";

export interface SecretFinding {
  kind: SecretFindingKind;
  path: string;
  line?: number;
  message: string;
  redactedContext: string;
}

export interface SecretScanInput {
  text: string;
  paths?: string[];
}

export interface SecretScanResult {
  ok: boolean;
  findings: SecretFinding[];
  redactedText: string;
}

interface SecretRule {
  kind: Exclude<SecretFindingKind, "sensitive_path">;
  label: string;
  pattern: RegExp;
}

const SECRET_RULES: SecretRule[] = [
  {
    kind: "private_key",
    label: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i
  },
  {
    kind: "database_url",
    label: "database URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>]+/i
  },
  {
    kind: "api_key",
    label: "API key",
    pattern: /\b(?:[A-Z0-9_]*API[_-]?KEY[A-Z0-9_]*\s*[:=]\s*["']?[^\s"']+|sk[-_](?:live|test)[-_][A-Za-z0-9_-]{12,})/i
  },
  {
    kind: "token",
    label: "token",
    pattern: /\b(?:[A-Z0-9_]*TOKEN[A-Z0-9_]*\s*[:=]\s*["']?[^\s"']+|gh[pousr]_[A-Za-z0-9_]{20,})/i
  }
];

export function scanSecrets(input: SecretScanInput): SecretScanResult {
  const diffContexts = parseDiffLineContexts(input.text);
  const diffPaths = unique(diffContexts.map((context) => context.path));
  const paths = unique([...(input.paths ?? []), ...diffPaths]);
  const sensitivePathFindings = findSensitivePathMatches(paths).map(
    (match): SecretFinding => ({
      kind: "sensitive_path",
      path: match.path,
      message: `Sensitive path changed: ${match.path} (${match.reason})`,
      redactedContext: match.path
    })
  );

  const secretFindings = diffContexts.flatMap((context) =>
    SECRET_RULES.flatMap((rule) => {
      if (!rule.pattern.test(context.content)) {
        return [];
      }

      return [
        {
          kind: rule.kind,
          path: context.path,
          line: context.line,
          message: `Secret-like value detected in ${context.path}: ${rule.label}`,
          redactedContext: redactSecrets(context.content)
        }
      ];
    })
  );

  const findings = [...secretFindings, ...sensitivePathFindings];

  return {
    ok: findings.length === 0,
    findings,
    redactedText: redactSecrets(input.text)
  };
}

interface DiffLineContext {
  path: string;
  line: number;
  content: string;
}

function parseDiffLineContexts(text: string): DiffLineContext[] {
  let currentPath = "unknown";

  return text.split(/\r?\n/).flatMap((line, index) => {
    const nextPath = parseDiffPath(line);

    if (nextPath) {
      currentPath = nextPath;
    }

    if (!line.startsWith("+") || line.startsWith("+++")) {
      return [];
    }

    return [
      {
        path: currentPath,
        line: index + 1,
        content: line.slice(1)
      }
    ];
  });
}

function parseDiffPath(line: string): string | null {
  if (!line.startsWith("+++ ")) {
    return null;
  }

  return normalizePath(line.slice(4).replace(/^b\//, ""));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
