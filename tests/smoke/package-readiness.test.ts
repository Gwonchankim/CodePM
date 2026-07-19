import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
  private?: boolean;
  license?: string;
  main?: string;
  types?: string;
  exports?: {
    ".": {
      import: string;
      types: string;
    };
  };
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
};

type PackDryRunEntry = {
  files: Array<{ path: string }>;
};

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
}

function runPackDryRun(): string[] {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required to run pack:dry-run from tests.");
  }
  const output = execFileSync(process.execPath, [npmCli, "run", "pack:dry-run", "--silent"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const entries = JSON.parse(output) as PackDryRunEntry[];

  return entries[0].files.map((file) =>
    file.path.replace(/\\/g, "/").replace(/^package\//, "")
  );
}

describe("package readiness", () => {
  it("declares package metadata, entrypoints, allowlisted files, and release scripts", () => {
    const packageJson = readPackageJson();

    expect(packageJson.private).toBe(true);
    expect(packageJson.license).toBe("UNLICENSED");
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.exports).toEqual({
      ".": {
        import: "./dist/index.js",
        types: "./dist/index.d.ts"
      }
    });
    expect(packageJson.bin).toEqual({
      codepm: "./dist/cli/index.js",
      "codepm-mcp": "./dist/mcp/index.js"
    });
    expect(packageJson.files).toEqual([
      "dist/**",
      "README.md",
      "docs/**",
      "plugins/codepm/**"
    ]);
    expect(packageJson.scripts?.["pack:dry-run"]).toContain(
      "--cache .tmp-codepm-tests/npm-cache"
    );
    expect(packageJson.scripts?.["pack:dry-run"]).toContain(
      "npm pack --dry-run --json"
    );
    expect(packageJson.scripts?.["pack:smoke"]).toBe("node scripts/package-smoke.mjs");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run typecheck");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run build");
    expect(packageJson.scripts?.["release:check"]).toContain("npm test");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run pack:dry-run");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run pack:smoke");
  });

  it("packs runtime output, docs, and plugin scaffold without source or temp files", () => {
    const files = runPackDryRun();

    expect(files).toEqual(
      expect.arrayContaining([
        "dist/cli/index.js",
        "dist/mcp/index.js",
        "dist/index.d.ts",
        "README.md",
        "docs/mcp.md",
        "docs/plugin.md",
        "docs/examples/github-read-review.md",
        "plugins/codepm/.codex-plugin/plugin.json",
        "plugins/codepm/.mcp.json",
        "plugins/codepm/skills/codepm/SKILL.md"
      ])
    );
    expect(files.some((file) => file.startsWith("src/"))).toBe(false);
    expect(files.some((file) => file.startsWith("tests/"))).toBe(false);
    expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(files.some((file) => file.startsWith(".tmp-codepm-tests/"))).toBe(
      false
    );
    expect(files.some((file) => file === ".env" || file.startsWith(".env."))).toBe(
      false
    );
  });

  it("documents release preflight without enabling publish", () => {
    const readme = readFileSync("README.md", "utf8");
    const releaseDocs = readFileSync("docs/release.md", "utf8");
    const pluginDocs = readFileSync("docs/plugin.md", "utf8");

    expect(readme).toContain("docs/release.md");
    expect(releaseDocs).toContain("Local Release Preflight");
    expect(releaseDocs).toContain("npm run pack:smoke");
    expect(releaseDocs).toContain("validate_plugin.py plugins\\codepm");
    expect(releaseDocs).toContain("private: true");
    expect(releaseDocs).toContain("Do not run `npm publish`");
    expect(releaseDocs).toContain("version bump");
    expect(releaseDocs).toContain("changelog");
    expect(releaseDocs).toContain("registry");
    expect(releaseDocs).toContain("release tag");
    expect(pluginDocs).toContain("npm run pack:smoke");
  });
});
