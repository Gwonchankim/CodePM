import { describe, expect, it } from "vitest";

import {
  REQUESTED_ACTIONS,
  isRequestedAction
} from "../../../src/domain/actions.js";
import { DECISIONS, isDecision } from "../../../src/domain/decision.js";

describe("domain contracts", () => {
  it("limits requested actions to the CodePM workflow actions", () => {
    expect(REQUESTED_ACTIONS).toEqual([
      "plan_review",
      "implementation_review",
      "push_branch",
      "create_pr",
      "merge_pr"
    ]);

    expect(isRequestedAction("plan_review")).toBe(true);
    expect(isRequestedAction("delete_branch")).toBe(false);
    expect(isRequestedAction(null)).toBe(false);
  });

  it("limits PM decisions to the gate decision values", () => {
    expect(DECISIONS).toEqual(["approve", "request_changes", "block"]);

    expect(isDecision("approve")).toBe(true);
    expect(isDecision("needs_work")).toBe(false);
    expect(isDecision(undefined)).toBe(false);
  });
});
