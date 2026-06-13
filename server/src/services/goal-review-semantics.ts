import { unprocessable } from "../errors.js";

export function validateGoalReviewVerdictReason(input: { verdict: string; reason: string }) {
  const reason = input.reason.trim();
  if (input.verdict === "stalled") {
    const lower = reason.toLowerCase();
    const hasMovementSignal =
      lower.includes("stalled") ||
      lower.includes("no movement") ||
      lower.includes("no progress") ||
      lower.includes("waiting") ||
      lower.includes("lack of progress") ||
      lower.includes("not moving");
    if (!hasMovementSignal) {
      throw unprocessable(
        'Stalled goal-review verdicts require a concrete lack-of-progress reason, for example "no movement since <date>" or "waiting on <owner/action>"',
      );
    }
  }

  if (input.verdict === "blocked") {
    const lower = reason.toLowerCase();
    const hasDependencySignal =
      lower.includes("blocked") ||
      lower.includes("waiting on") ||
      lower.includes("depends on") ||
      lower.includes("dependency") ||
      lower.includes("owner:") ||
      lower.includes("unblock") ||
      lower.includes("by ");
    if (!hasDependencySignal) {
      throw unprocessable(
        'Blocked goal-review verdicts require a concrete dependency path or unblock owner/action, for example "waiting on CTO to approve plan"',
      );
    }
  }
}

export function isPlanningIssueForGoal(input: {
  workMode: string | null | undefined;
  goalId: string | null | undefined;
}) {
  return input.workMode === "planning" && typeof input.goalId === "string" && input.goalId.length > 0;
}

