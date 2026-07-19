import { describe, expect, it, vi } from "vitest";

import { getHelpText, runCli } from "../../src/cli/index.js";

describe("CodePM CLI", () => {
  it("prints help text for --help", () => {
    const output = vi.fn();

    const exitCode = runCli(["--help"], output);

    expect(exitCode).toBe(0);
    expect(output).toHaveBeenCalledWith(getHelpText());
    expect(getHelpText()).toContain("Usage: codepm");
    expect(getHelpText()).toContain("review-plan");
  });
});
