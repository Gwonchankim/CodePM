import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const smokeRoot = join(repoRoot, ".tmp-codepm-tests", "package-smoke");
const packDir = join(smokeRoot, "pack");
const extractDir = join(smokeRoot, "extract");
const consumerDir = join(smokeRoot, "consumer");
const installDir = join(consumerDir, "node_modules", "codepm");
const npmCacheDir = join(smokeRoot, "npm-cache");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required. Run this check through npm run pack:smoke.");
  }

  return run(process.execPath, [npmCli, ...args]);
}

function collectFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(current, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");

    if (entry.isDirectory()) {
      return collectFiles(root, absolutePath);
    }

    return [relativePath];
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
mkdirSync(extractDir, { recursive: true });
mkdirSync(join(consumerDir, "node_modules"), { recursive: true });

const packOutput = runNpm([
  "pack",
  "--json",
  "--pack-destination",
  packDir,
  "--cache",
  npmCacheDir
]);
const packEntries = JSON.parse(packOutput);
const tarballName = packEntries[0]?.filename;
assert(typeof tarballName === "string", "npm pack did not report a tarball filename.");

const tarballPath = resolve(packDir, tarballName);
assert(existsSync(tarballPath), `Expected tarball to exist at ${tarballPath}.`);

run("tar", ["-xzf", tarballPath, "-C", extractDir]);
const extractedPackageDir = join(extractDir, "package");
assert(existsSync(extractedPackageDir), "Expected npm tarball to extract a package directory.");

cpSync(extractedPackageDir, installDir, { recursive: true });

const cliHelp = run(process.execPath, [join(installDir, "dist", "cli", "index.js"), "--help"]);
assert(cliHelp.includes("CodePM - local PM gate"), "Installed CLI help did not run.");

const mcpHelp = run(process.execPath, [join(installDir, "dist", "mcp", "index.js"), "--help"]);
assert(mcpHelp.includes("CodePM MCP server"), "Installed MCP help did not run.");

writeFileSync(
  join(consumerDir, "verify.mjs"),
  [
    'import { CODEPM_PLUGIN_CAPABILITIES } from "codepm";',
    'if (CODEPM_PLUGIN_CAPABILITIES?.supportsExecutionMutation !== false) {',
    '  throw new Error("Package export did not expose CodePM plugin capabilities.");',
    "}"
  ].join("\n")
);
run(process.execPath, [join(consumerDir, "verify.mjs")], { cwd: consumerDir });

const installedFiles = collectFiles(installDir);
const disallowedPrefixes = ["src/", "tests/", "node_modules/", ".tmp-codepm-tests/"];
const disallowedFile = installedFiles.find((file) =>
  disallowedPrefixes.some((prefix) => file.startsWith(prefix))
);
assert(!disallowedFile, `Unexpected package file included: ${disallowedFile}`);

const envFile = installedFiles.find((file) => {
  const name = file.split("/").at(-1) ?? file;
  return name === ".env" || name.startsWith(".env.");
});
assert(!envFile, `Unexpected env file included: ${envFile}`);

console.log(`Package smoke passed: ${tarballName}`);
