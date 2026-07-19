import { readFileSync } from "node:fs";

export function readClaudeTranscript(path: string): string {
  return readFileSync(path, "utf8");
}
