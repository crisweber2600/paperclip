import { describe, expect, it } from "vitest";
import {
  goalOperatorViewSchema,
  goalReviewResponseSchema,
  goalReviewWakeContextSchema,
  recordGoalVerdictsResponseSchema,
} from "./goal.js";

describe("goal contract validators", () => {
  it("accepts operator goal views with execution-path state", () => {
    const parsed = goalOperatorViewSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "22222222-2222-4222-8222-222222222222",
      title: "Ship V1",
      description: null,
      level: "company",
      status: "active",
      parentId: null,
      ownerAgentId: null,
      acceptanceCriteria: ["done means done"],
      lastVerdict: null,
      lastVerdictReason: null,
      lastVerdictAt: null,
      lastVerdictByAgentId: null,
      verdictStreak: 0,
      pauseReason: null,
      pausedAt: null,
      createdAt: "2026-06-13T18:00:00.000Z",
      updatedAt: "2026-06-13T18:00:00.000Z",
      executionPath: { openIssueCount: 1, openProjectCount: 0, hasExecutionPath: true },
      needsPlanning: false,
    });

    expect(parsed.executionPath.openIssueCount).toBe(1);
  });

  it("accepts goal-review responses", () => {
    const parsed = goalReviewResponseSchema.parse({
      agentId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      generatedAt: "2026-06-13T18:00:00.000Z",
      intervalHours: 4,
      lastReviewedAt: "2026-06-13T14:00:00.000Z",
      routineHint: "hint",
      goals: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Ship V1",
          description: null,
          level: "company",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          acceptanceCriteria: ["done means done"],
          lastVerdict: null,
          lastVerdictReason: null,
          lastVerdictAt: null,
          verdictStreak: 0,
          verdictStale: true,
          pausedAt: null,
          pauseReason: null,
          ancestors: [],
          executionPath: { openIssueCount: 1, openProjectCount: 0, hasExecutionPath: true },
          needsPlanning: false,
        },
      ],
    });

    expect(parsed.goals[0]?.executionPath.hasExecutionPath).toBe(true);
  });

  it("accepts goal-review verdict responses", () => {
    const parsed = recordGoalVerdictsResponseSchema.parse({
      agentId: "11111111-1111-4111-8111-111111111111",
      recordedCount: 1,
      attentionGoalCount: 1,
      planningIssues: [
        {
          goalId: "33333333-3333-4333-8333-333333333333",
          issueId: "44444444-4444-4444-8444-444444444444",
          identifier: "PAP-1",
          title: "Plan: Ship V1",
          reused: false,
        },
      ],
      results: [
        {
          goalId: "33333333-3333-4333-8333-333333333333",
          verdict: "stalled",
          verdictStreak: 1,
          recordedAt: "2026-06-13T18:00:00.000Z",
        },
      ],
    });

    expect(parsed.results[0]?.verdict).toBe("stalled");
  });

  it("accepts goal-review wake context", () => {
    const parsed = goalReviewWakeContextSchema.parse({
      due: true,
      ownedActiveGoalCount: 2,
      goalsWithoutExecutionPathCount: 1,
      goalsWithoutExecutionPath: [{ id: "33333333-3333-4333-8333-333333333333", title: "Ship V1" }],
      attentionGoalCount: 1,
      attentionGoals: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Ship V1",
          lastVerdict: "blocked",
          verdictStreak: 2,
        },
      ],
    });

    expect(parsed.attentionGoals[0]?.lastVerdict).toBe("blocked");
  });
});
