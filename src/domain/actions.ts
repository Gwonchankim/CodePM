export const REQUESTED_ACTIONS = [
  "plan_review",
  "implementation_review",
  "push_branch",
  "create_pr",
  "merge_pr"
] as const;

export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

const requestedActionSet = new Set<string>(REQUESTED_ACTIONS);

export function isRequestedAction(value: unknown): value is RequestedAction {
  return typeof value === "string" && requestedActionSet.has(value);
}
