import { describe, expect, it } from "vitest";
import { goalReviewResponseSchema, goalReviewWakeContextSchema, recordGoalVerdictsResponseSchema } from "@paperclipai/shared";

describe("goal-review shared contracts", () => {
  it("parses the route response shape", () => {
    const parsed = goalReviewResponseSchema.parse({
      agentId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      generatedAt: "2026-06-13T18:00:00.000Z",
      intervalHours: 4,
      lastReviewedAt: null,
      routineHint: "hint",
      goals: [],
    });

    expect(parsed.intervalHours).toBe(4);
  });

  it("parses verdict response and wake context shapes", () => {
    expect(
      recordGoalVerdictsResponseSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        recordedCount: 0,
        attentionGoalCount: 0,
        planningIssues: [],
        results: [],
      }).recordedCount,
    ).toBe(0);

    expect(
      goalReviewWakeContextSchema.parse({
        due: true,
        ownedActiveGoalCount: 0,
        goalsWithoutExecutionPathCount: 0,
        goalsWithoutExecutionPath: [],
        attentionGoalCount: 0,
        attentionGoals: [],
      }).due,
    ).toBe(true);
  });
});
