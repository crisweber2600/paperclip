import { describe, expect, it } from "vitest";
import { getGoalAncestors, MAX_GOAL_ANCESTOR_DEPTH } from "../services/goals.js";
import {
  DEFAULT_GOAL_REVIEW_INTERVAL_HOURS,
  goalReviewService,
  isGoalReviewDue,
  parseGoalReviewRuntimeState,
} from "../services/goal-review.js";

// Queue-based fake Db: each db.select() consumes the next queued result, no
// matter how the chain (from/where/groupBy/innerJoin/orderBy) is composed.
function fakeDb(queues: unknown[][]) {
  let call = 0;
  const db = {
    selectCallCount: () => call,
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
