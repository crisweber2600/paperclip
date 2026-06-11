import { describe, expect, it } from "vitest";
import { getGoalAncestors, goalService, MAX_GOAL_ANCESTOR_DEPTH } from "../services/goals.js";
import {
  DEFAULT_GOAL_REVIEW_INTERVAL_HOURS,
  DEFAULT_GOAL_REVIEW_MAX_VERDICT_STREAK,
  DEFAULT_GOAL_REVIEW_STALLED_INTERVAL_HOURS,
  goalReviewService,
  isAttentionGoal,
  isGoalReviewDue,
  parseGoalReviewRuntimeState,
} from "../services/goal-review.js";

// Queue-based fake Db: each db.select() consumes the next queued result, no
// matter how the chain (from/where/groupBy/innerJoin/orderBy) is composed.
function fakeDb(queues: unknown[][]) {
  let call = 0;
  const updateSets: Record<string, unknown>[] = [];
  const updateResults = [...queues];
  const db = {
    selectCallCount: () => call,
    updateSets,
    select: () => {
      const result = queues[call] ?? [];
      call += 1;
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "groupBy", "innerJoin", "orderBy"]) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        const result = updateResults[call] ?? [];
        call += 1;
        return {
          where: () => ({
            returning: () => ({
              then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
            }),
          }),
        };
      },
    }),
  };
  return db;
}

function goalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "goal-1",
    companyId: "company-1",
    title: "Ship V1",
    description: null,
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: "agent-1",
    acceptanceCriteria: [],
    lastVerdict: null,
    lastVerdictReason: null,
    lastVerdictAt: null,
    lastVerdictByAgentId: null,
    verdictStreak: 0,
    pauseReason: null,
    pausedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("getGoalAncestors", () => {
  it("returns an empty list for a missing goal", async () => {
    const db = fakeDb([[]]);
    expect(await getGoalAncestors(db as never, "missing")).toEqual([]);
  });

  it("returns an empty list for a root goal", async () => {
    const db = fakeDb([[goalRow()]]);
    expect(await getGoalAncestors(db as never, "goal-1")).toEqual([]);
  });

  it("walks the parent chain nearest-parent first", async () => {
    const grandparent = goalRow({ id: "goal-root", level: "company" });
    const parent = goalRow({ id: "goal-team", level: "team", parentId: "goal-root" });
    const child = goalRow({ id: "goal-task", level: "task", parentId: "goal-team" });
    const db = fakeDb([[child], [parent], [grandparent]]);

    const ancestors = await getGoalAncestors(db as never, "goal-task");
    expect(ancestors.map((goal) => goal.id)).toEqual(["goal-team", "goal-root"]);
  });

  it("stops on a parent cycle", async () => {
    const a = goalRow({ id: "goal-a", parentId: "goal-b" });
    const b = goalRow({ id: "goal-b", parentId: "goal-a" });
    const db = fakeDb([[a], [b]]);

    const ancestors = await getGoalAncestors(db as never, "goal-a");
    expect(ancestors.map((goal) => goal.id)).toEqual(["goal-b"]);
  });

  it("caps the walk at MAX_GOAL_ANCESTOR_DEPTH", async () => {
    const chainLength = MAX_GOAL_ANCESTOR_DEPTH + 4;
    const queues: unknown[][] = [];
    for (let index = 0; index <= chainLength; index += 1) {
      queues.push([
        goalRow({
          id: `goal-${index}`,
          parentId: index < chainLength ? `goal-${index + 1}` : null,
        }),
      ]);
    }
    const db = fakeDb(queues);

    const ancestors = await getGoalAncestors(db as never, "goal-0");
    expect(ancestors).toHaveLength(MAX_GOAL_ANCESTOR_DEPTH);
  });
});

describe("parseGoalReviewRuntimeState", () => {
  it("returns empty state for missing or malformed input", () => {
    expect(parseGoalReviewRuntimeState(null)).toEqual({});
    expect(parseGoalReviewRuntimeState({})).toEqual({});
    expect(parseGoalReviewRuntimeState({ goalReview: "nope" })).toEqual({});
    expect(parseGoalReviewRuntimeState({ goalReview: { lastCheckedAt: 42 } })).toEqual({});
  });

  it("parses known timestamp fields", () => {
    expect(
      parseGoalReviewRuntimeState({
        goalReview: {
          lastEvaluatedAt: "2026-06-09T10:00:00Z",
          lastSurfacedAt: "2026-06-09T09:00:00Z",
          lastCheckedAt: "2026-06-09T08:00:00Z",
          unknown: "ignored",
        },
      }),
    ).toEqual({
      lastEvaluatedAt: "2026-06-09T10:00:00Z",
      lastSurfacedAt: "2026-06-09T09:00:00Z",
      lastCheckedAt: "2026-06-09T08:00:00Z",
    });
  });

  it("parses the numeric attentionGoalCount and rejects non-numeric values", () => {
    expect(
      parseGoalReviewRuntimeState({
        goalReview: { lastCheckedAt: "2026-06-09T08:00:00Z", attentionGoalCount: 2 },
      }),
    ).toEqual({ lastCheckedAt: "2026-06-09T08:00:00Z", attentionGoalCount: 2 });
    expect(
      parseGoalReviewRuntimeState({ goalReview: { attentionGoalCount: "2" } }),
    ).toEqual({});
  });
});

describe("isGoalReviewDue", () => {
  const now = new Date("2026-06-09T12:00:00Z");

  it("is due when no review has ever happened", () => {
    expect(isGoalReviewDue({ state: {}, now, intervalHours: 4 })).toBe(true);
  });

  it("is not due inside the interval window", () => {
    expect(
      isGoalReviewDue({
        state: { lastEvaluatedAt: "2026-06-09T11:00:00Z" },
        now,
        intervalHours: 4,
      }),
    ).toBe(false);
  });

  it("is due once the interval has elapsed since the most recent stamp", () => {
    expect(
      isGoalReviewDue({
        state: {
          lastCheckedAt: "2026-06-09T01:00:00Z",
          lastSurfacedAt: "2026-06-09T02:00:00Z",
        },
        now,
        intervalHours: 4,
      }),
    ).toBe(true);
  });

  it("uses the most recent of all stamps", () => {
    expect(
      isGoalReviewDue({
        state: {
          lastCheckedAt: "2026-06-09T01:00:00Z",
          lastSurfacedAt: "2026-06-09T11:30:00Z",
        },
        now,
        intervalHours: 4,
      }),
    ).toBe(false);
  });

  it("defaults the interval when not provided", () => {
    const recent = new Date(now.getTime() - (DEFAULT_GOAL_REVIEW_INTERVAL_HOURS - 1) * 60 * 60 * 1000);
    expect(
      isGoalReviewDue({ state: { lastEvaluatedAt: recent.toISOString() }, now }),
    ).toBe(false);
  });

  it("tightens the cadence when attention goals are pending", () => {
    // 2h since last review: not due at the normal 4h interval, but due at the
    // stalled 1h interval when attentionGoalCount > 0.
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(
      isGoalReviewDue({ state: { lastEvaluatedAt: twoHoursAgo, attentionGoalCount: 0 }, now }),
    ).toBe(false);
    expect(
      isGoalReviewDue({ state: { lastEvaluatedAt: twoHoursAgo, attentionGoalCount: 1 }, now }),
    ).toBe(true);
    const withinStalledInterval = new Date(
      now.getTime() - (DEFAULT_GOAL_REVIEW_STALLED_INTERVAL_HOURS * 60 * 60 * 1000) / 2,
    ).toISOString();
    expect(
      isGoalReviewDue({ state: { lastEvaluatedAt: withinStalledInterval, attentionGoalCount: 1 }, now }),
    ).toBe(false);
  });
});

describe("isAttentionGoal", () => {
  it("flags stalled/blocked goals under the streak cap and nothing else", () => {
    expect(isAttentionGoal({ lastVerdict: "stalled", verdictStreak: 1 })).toBe(true);
    expect(isAttentionGoal({ lastVerdict: "blocked", verdictStreak: 2 })).toBe(true);
    expect(isAttentionGoal({ lastVerdict: "progressing", verdictStreak: 1 })).toBe(false);
    expect(isAttentionGoal({ lastVerdict: "done", verdictStreak: 1 })).toBe(false);
    expect(isAttentionGoal({ lastVerdict: null, verdictStreak: 0 })).toBe(false);
    expect(
      isAttentionGoal({ lastVerdict: "stalled", verdictStreak: DEFAULT_GOAL_REVIEW_MAX_VERDICT_STREAK }),
    ).toBe(false);
  });
});

describe("goalReviewService.buildGoalReviewWakeSummary", () => {
  it("lists attention goals and excludes those at the streak cap", async () => {
    const ownedGoals = [
      goalRow({ id: "goal-stalled", title: "Stalled goal", lastVerdict: "stalled", verdictStreak: 2 }),
      goalRow({
        id: "goal-exhausted",
        title: "Exhausted goal",
        lastVerdict: "stalled",
        verdictStreak: DEFAULT_GOAL_REVIEW_MAX_VERDICT_STREAK,
      }),
      goalRow({ id: "goal-progressing", title: "Progressing goal", lastVerdict: "progressing", verdictStreak: 1 }),
    ];
    const db = fakeDb([
      ownedGoals, // listActiveOwnedByAgent
      [], // open issues grouped by goal
      [], // legacy project links
      [], // project_goals links
    ]);
    const summary = await goalReviewService(db as never).buildGoalReviewWakeSummary({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });

    expect(summary).not.toBeNull();
    expect(summary?.attentionGoalCount).toBe(1);
    expect(summary?.attentionGoals).toEqual([
      { id: "goal-stalled", title: "Stalled goal", lastVerdict: "stalled", verdictStreak: 2 },
    ]);
    expect(summary?.goalsWithoutExecutionPathCount).toBe(3);
  });
});

describe("goalService.recordVerdict", () => {
  it("increments the streak on a repeated verdict", async () => {
    const existing = goalRow({ lastVerdict: "stalled", verdictStreak: 2 });
    const db = fakeDb([
      [existing],
      [{ ...existing, lastVerdict: "stalled", verdictStreak: 3 }],
    ]);
    const updated = await goalService(db as never).recordVerdict("goal-1", {
      verdict: "stalled",
      reason: "still no movement",
      byAgentId: "agent-1",
    });
    expect((db as { updateSets: Record<string, unknown>[] }).updateSets[0]).toEqual(
      expect.objectContaining({
        lastVerdict: "stalled",
        lastVerdictReason: "still no movement",
        lastVerdictByAgentId: "agent-1",
        verdictStreak: 3,
      }),
    );
    expect(updated).toEqual(expect.objectContaining({ verdictStreak: 3 }));
  });

  it("resets the streak when the verdict changes", async () => {
    const existing = goalRow({ lastVerdict: "stalled", verdictStreak: 4 });
    const db = fakeDb([[existing], [{ ...existing, lastVerdict: "progressing", verdictStreak: 1 }]]);
    await goalService(db as never).recordVerdict("goal-1", {
      verdict: "progressing",
      reason: "issue moving again",
      byAgentId: "agent-1",
    });
    expect((db as { updateSets: Record<string, unknown>[] }).updateSets[0]).toEqual(
      expect.objectContaining({ verdictStreak: 1 }),
    );
  });

  it("returns null for a missing goal", async () => {
    const db = fakeDb([[]]);
    expect(
      await goalService(db as never).recordVerdict("missing", {
        verdict: "done",
        reason: "n/a",
        byAgentId: "agent-1",
      }),
    ).toBeNull();
  });
});

describe("goalReviewService.getExecutionPaths", () => {
  it("returns an empty map without querying when no goal ids are given", async () => {
    const db = fakeDb([]);
    const svc = goalReviewService(db as never);
    const result = await svc.getExecutionPaths("company-1", []);
    expect(result.size).toBe(0);
    expect(db.selectCallCount()).toBe(0);
  });

  it("flags goals with open issues as having an execution path", async () => {
    const db = fakeDb([
      [{ goalId: "goal-1", openIssueCount: 3 }], // open issues grouped by goal
      [], // legacy projects.goalId
      [], // project_goals join
    ]);
    const svc = goalReviewService(db as never);
    const result = await svc.getExecutionPaths("company-1", ["goal-1", "goal-2"]);

    expect(result.get("goal-1")).toEqual({
      openIssueCount: 3,
      openProjectCount: 0,
      hasExecutionPath: true,
    });
    expect(result.get("goal-2")).toEqual({
      openIssueCount: 0,
      openProjectCount: 0,
      hasExecutionPath: false,
    });
  });

  it("dedupes the same project across the legacy column and the join table", async () => {
    const db = fakeDb([
      [],
      [{ goalId: "goal-1", projectId: "project-1" }],
      [
        { goalId: "goal-1", projectId: "project-1" },
        { goalId: "goal-1", projectId: "project-2" },
      ],
    ]);
    const svc = goalReviewService(db as never);
    const result = await svc.getExecutionPaths("company-1", ["goal-1"]);

    expect(result.get("goal-1")).toEqual({
      openIssueCount: 0,
      openProjectCount: 2,
      hasExecutionPath: true,
    });
  });
});
