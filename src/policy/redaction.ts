export const REDACTED_SECRET = "***REDACTED***";

const PRIVATE_KEY_BLOCK_PATTERN =
  /\+?-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?\+?-----END [A-Z ]*PRIVATE KEY-----/g;
const DATABASE_URL_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>]+/gi;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g;
const OPENAI_KEY_PATTERN = /\bsk[-_](?:live|test)[-_][A-Za-z0-9_-]{12,}\b/g;
const ASSIGNED_SECRET_PATTERN =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*[:=]\s*["']?)([^"'\s]+)/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED_SECRET)
    .replace(ASSIGNED_SECRET_PATTERN, `$1${REDACTED_SECRET}`)
    .replace(DATABASE_URL_PATTERN, REDACTED_SECRET)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED_SECRET)
    .replace(OPENAI_KEY_PATTERN, REDACTED_SECRET);
}
