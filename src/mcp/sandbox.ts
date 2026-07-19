import { delimiter, isAbsolute, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface McpPathPolicyResult {
  ok: boolean;
  resolvedPath: string;
  allowedRoots: string[];
}

export function resolveMcpPathPolicy(path: string): McpPathPolicyResult {
  const resolvedPath = resolveRealPath(path);
  const allowedRoots = getAllowedRoots().map((root) => resolveRealPath(root));
  const comparablePath = toComparablePath(resolvedPath);

  return {
    ok: allowedRoots.some((root) =>
      isPathInsideRoot(comparablePath, toComparablePath(root))
    ),
    resolvedPath,
    allowedRoots
  };
}

export function resolveConfigPath(cwd: string, configPath?: string): string | undefined {
  if (!configPath) {
    return undefined;
  }

  return isAbsolute(configPath) ? resolve(configPath) : resolve(cwd, configPath);
}

function getAllowedRoots(): string[] {
  const configuredRoots = process.env.CODEPM_MCP_ALLOWED_ROOTS?.split(delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0);

  if (!configuredRoots || configuredRoots.length === 0) {
    return [PACKAGE_ROOT];
  }

  return configuredRoots.map((root) =>
    isAbsolute(root) ? resolve(root) : resolve(PACKAGE_ROOT, root)
  );
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function toComparablePath(path: string): string {
  const resolved = resolve(path);

  if (process.platform === "win32") {
    return resolved.toLowerCase();
  }

  return resolved;
}

function isPathInsideRoot(path: string, root: string): boolean {
  if (path === root) {
    return true;
  }

  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(rootWithSeparator);
}
