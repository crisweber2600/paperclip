import { describe, expect, it } from "vitest";
import { classifyRunLiveness } from "../services/run-liveness.ts";
import {
  RUN_LIVENESS_CONTINUATION_REASON,
  decideRunLivenessContinuation,
} from "../services/recovery/run-liveness-continuations.ts";

const baseInput = {
  runStatus: "succeeded",
  issue: {
    status: "in_progress",
    title: "Implement feature",
    description: "Add the requested behavior.",
  },
  resultJson: null,
  stdoutExcerpt: null,
  stderrExcerpt: null,
  error: null,
  errorCode: null,
  continuationAttempt: 0,
  evidence: null,
};

describe("run liveness classifier", () => {
  it("classifies text-only future work as plan_only", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I will inspect the repo next and then implement the fix.",
      },
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toContain("inspect the repo");
  });

  it("classifies empty successful output as empty_response", () => {
    const classification = classifyRunLiveness(baseInput);

    expect(classification.livenessState).toBe("empty_response");
    expect(classification.actionability).toBe("unknown");
  });

  it("treats issue comments, documents, products, and actions as progress", () => {
    const latestEvidenceAt = new Date("2026-04-18T12:00:00Z");
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Updated implementation.",
      },
      evidence: {
        issueCommentsCreated: 1,
        documentRevisionsCreated: 1,
        workProductsCreated: 1,
        toolOrActionEventsCreated: 1,
        latestEvidenceAt,
      },
    });

    expect(classification.livenessState).toBe("advanced");
    expect(classification.lastUsefulActionAt).toBe(latestEvidenceAt);
  });

  it("does not treat workspace operations alone as concrete progress", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I will inspect the repo next.",
      },
      evidence: {
        workspaceOperationsCreated: 1,
        latestEvidenceAt: new Date("2026-04-18T12:00:00Z"),
      },
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.lastUsefulActionAt).toBeNull();
  });

  it("exempts planning/document tasks from plan-only retry classification", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issue: {
        status: "in_progress",
        title: "Draft implementation plan",
        description: "Create a plan for the work.",
      },
      resultJson: {
        summary: "Plan:\n- Inspect files\n- Implement after approval",
      },
    });

    expect(classification.livenessState).toBe("advanced");
  });

  it("exempts runs that update the plan document from plan-only classification", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next steps:\n- inspect files\n- implement the service",
      },
      evidence: {
        documentRevisionsCreated: 1,
        planDocumentRevisionsCreated: 1,
        latestEvidenceAt: new Date("2026-04-18T12:00:00Z"),
      },
    });

    expect(classification.livenessState).toBe("advanced");
  });

  it("classifies done issues as completed", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issue: {
        ...baseInput.issue,
        status: "done",
      },
      resultJson: {
        summary: "Finished the implementation.",
      },
    });

    expect(classification.livenessState).toBe("completed");
  });

  it("classifies declared blockers as blocked", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I cannot proceed because I need access credentials.",
      },
    });

    expect(classification.livenessState).toBe("blocked");
    expect(classification.actionability).toBe("blocked_external");
  });

  it("treats PAP-2000-style validation output as runnable follow-up, not an external blocker", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "PAP-1949 remains blocked until PAP-2000 is resolved.",
      },
      issueCommentBodies: [
        [
          "Validation is ready for the next pass.",
          "",
          "- Blocked chain context: PAP-1949 -> PAP-1999 -> PAP-2000",
          "- Next action: run npm test and report the row counts.",
        ].join("\n"),
      ],
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toBe("run npm test and report the row counts.");
  });

  it("prefers durable comments over raw transcript next-action noise", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issueCommentBodies: ["Next action: run pnpm test -- --runInBand."],
      stdoutExcerpt: [
        "tool_call: write",
        "command: rm -rf production-data",
        "Next action: deploy to production",
      ].join("\n"),
    });

    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toBe("run pnpm test -- --runInBand.");
  });

  it("keeps approval requests out of automatic continuation", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next action: wait for board approval before continuing.",
      },
    });

    expect(classification.livenessState).toBe("blocked");
    expect(classification.actionability).toBe("approval_required");
    expect(classification.nextAction).toBe("wait for board approval before continuing.");
  });

  it("routes production-sensitive next actions to manager review", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next action: deploy to production and verify live traffic.",
      },
    });

    expect(classification.livenessState).toBe("needs_followup");
    expect(classification.actionability).toBe("manager_review");
    expect(classification.nextAction).toBe("deploy to production and verify live traffic.");
  });

  it("marks unclear useful output as unknown actionability", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Observed mixed output and left notes for a later pass.",
      },
    });

    expect(classification.livenessState).toBe("needs_followup");
    expect(classification.actionability).toBe("unknown");
    expect(classification.nextAction).toBeNull();
  });
});

const run = {
  id: "run-1",
  companyId: "company-1",
  agentId: "agent-1",
  continuationAttempt: 0,
  contextSnapshot: { issueId: "issue-1" },
} as any;

const issue = {
  id: "issue-1",
  companyId: "company-1",
  status: "in_progress",
  assigneeAgentId: "agent-1",
  executionState: null,
} as any;

const agent = {
  id: "agent-1",
  companyId: "company-1",
  status: "idle",
} as any;

describe("run liveness continuation decision", () => {
  it("carries prior goal-review context into later continuation heartbeats", () => {
    const decision = decideRunLivenessContinuation({
      run: {
        ...run,
        contextSnapshot: {
          issueId: "issue-1",
          paperclipGoalReview: {
            due: true,
            ownedActiveGoalCount: 2,
            goalsWithoutExecutionPathCount: 1,
            goalsWithoutExecutionPath: [{ id: "goal-1", title: "Unblock launch" }],
            attentionGoalCount: 1,
            attentionGoals: [{ id: "goal-2", title: "Fix regressions", lastVerdict: "stalled", verdictStreak: 2 }],
          },
        },
      } as any,
      issue,
      agent,
      livenessState: "plan_only",
      livenessReason: "Need concrete next action",
      nextAction: null,
      budgetBlocked: false,
      idempotentWakeExists: false,
    });

    expect(decision.kind).toBe("enqueue");
    if (decision.kind !== "enqueue") return;
    expect(decision.idempotencyKey).toBe(`${RUN_LIVENESS_CONTINUATION_REASON}:issue-1:run-1:plan_only:1`);
    expect(decision.contextSnapshot).toMatchObject({
      wakeReason: RUN_LIVENESS_CONTINUATION_REASON,
      paperclipGoalReview: {
        due: true,
        ownedActiveGoalCount: 2,
        goalsWithoutExecutionPathCount: 1,
        attentionGoalCount: 1,
      },
    });
  });
});
