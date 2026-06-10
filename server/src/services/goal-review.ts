import { and, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentRuntimeState, issues, projectGoals, projects } from "@paperclipai/db";
import { goalService } from "./goals.js";

// Issue statuses that still count as "someone is advancing this goal".
// backlog/blocked are intentionally open: a parked plan still proves the goal
// was converted into work — the gap signal is "nothing at all links to it".
const TERMINAL_ISSUE_STATUSES = ["done", "cancelled"];
const OPEN_PROJECT_STATUSES = ["backlog", "planned", "in_progress"];

export const DEFAULT_GOAL_REVIEW_INTERVAL_HOURS = 4;
export const GOAL_REVIEW_WAKE_GOAL_CAP = 5;

export function getGoalReviewIntervalHours() {
  const raw = Number(process.env.PAPERCLIP_GOAL_REVIEW_INTERVAL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOAL_REVIEW_INTERVAL_HOURS;
}

export interface GoalExecutionPath {
  openIssueCount: number;
  openProjectCount: number;
  hasExecutionPath: boolean;
}

export interface GoalReviewRuntimeState {
  lastEvaluatedAt?: string;
  lastSurfacedAt?: string;
  lastCheckedAt?: string;
}

export function parseGoalReviewRuntimeState(stateJson: unknown): GoalReviewRuntimeState {
  if (!stateJson || typeof stateJson !== "object") return {};
  const raw = (stateJson as Record<string, unknown>).goalReview;
  if (!raw || typeof raw !== "object") return {};
  const parsed: GoalReviewRuntimeState = {};
  for (const key of ["lastEvaluatedAt", "lastSurfacedAt", "lastCheckedAt"] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) parsed[key] = value;
  }
  return parsed;
}

export function isGoalReviewDue(input: {
  state: GoalReviewRuntimeState;
  now: Date;
  intervalHours?: number;
}) {
  const intervalMs = (input.intervalHours ?? getGoalReviewIntervalHours()) * 60 * 60 * 1000;
  const timestamps = [
    input.state.lastEvaluatedAt,
    input.state.lastSurfacedAt,
    input.state.lastCheckedAt,
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return true;
  return input.now.getTime() - Math.max(...timestamps) > intervalMs;
}

export function goalReviewService(db: Db) {
  const goalsSvc = goalService(db);

  async function getExecutionPaths(
    companyId: string,
    goalIds: string[],
  ): Promise<Map<string, GoalExecutionPath>> {
    const result = new Map<string, GoalExecutionPath>(
      goalIds.map((id) => [id, { openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false }]),
    );
    if (goalIds.length === 0) return result;

    const [issueRows, legacyProjectRows, linkedProjectRows] = await Promise.all([
      db
        .select({ goalId: issues.goalId, openIssueCount: count() })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.goalId, goalIds),
            notInArray(issues.status, TERMINAL_ISSUE_STATUSES),
          ),
        )
        .groupBy(issues.goalId),
      db
        .select({ goalId: projects.goalId, projectId: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.companyId, companyId),
            inArray(projects.goalId, goalIds),
            inArray(projects.status, OPEN_PROJECT_STATUSES),
          ),
        ),
      db
        .select({ goalId: projectGoals.goalId, projectId: projectGoals.projectId })
        .from(projectGoals)
        .innerJoin(projects, eq(projectGoals.projectId, projects.id))
        .where(
          and(
            eq(projectGoals.companyId, companyId),
            inArray(projectGoals.goalId, goalIds),
            inArray(projects.status, OPEN_PROJECT_STATUSES),
          ),
        ),
    ]);

    for (const row of issueRows) {
      if (!row.goalId) continue;
      const entry = result.get(row.goalId);
      if (entry) entry.openIssueCount = Number(row.openIssueCount ?? 0);
    }

    // Union of legacy projects.goalId and the project_goals join table,
    // deduped per goal since both can reference the same project.
    const projectIdsByGoal = new Map<string, Set<string>>();
    for (const row of [...legacyProjectRows, ...linkedProjectRows]) {
      if (!row.goalId) continue;
      const set = projectIdsByGoal.get(row.goalId) ?? new Set<string>();
      set.add(row.projectId);
      projectIdsByGoal.set(row.goalId, set);
    }
    for (const [goalId, projectIds] of projectIdsByGoal) {
      const entry = result.get(goalId);
      if (entry) entry.openProjectCount = projectIds.size;
    }

    for (const entry of result.values()) {
      entry.hasExecutionPath = entry.openIssueCount > 0 || entry.openProjectCount > 0;
    }
    return result;
  }

  async function listOwnedActiveGoals(agent: { id: string; companyId: string; role: string }) {
    return goalsSvc.listActiveOwnedByAgent(agent.companyId, agent.id, {
      // The CEO is also accountable for active company-level goals nobody owns.
      includeUnownedCompanyLevel: agent.role === "ceo",
    });
  }

  async function buildGoalReview(agent: { id: string; companyId: string; role: string }) {
    const ownedGoals = await listOwnedActiveGoals(agent);
    const executionPaths = await getExecutionPaths(
      agent.companyId,
      ownedGoals.map((goal) => goal.id),
    );
    const ancestorsByGoal = await Promise.all(
      ownedGoals.map((goal) => goalsSvc.getAncestors(goal.id)),
    );
    return ownedGoals.map((goal, index) => {
      const executionPath =
        executionPaths.get(goal.id) ??
        ({ openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false } satisfies GoalExecutionPath);
      return {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        level: goal.level,
        status: goal.status,
        parentId: goal.parentId,
        ownerAgentId: goal.ownerAgentId,
        ancestors: ancestorsByGoal[index].map((ancestor) => ({
          id: ancestor.id,
          title: ancestor.title,
          level: ancestor.level,
          status: ancestor.status,
        })),
        executionPath,
        needsPlanning: goal.status === "active" && !executionPath.hasExecutionPath,
      };
    });
  }

  async function buildGoalReviewWakeSummary(agent: { id: string; companyId: string; role: string }) {
    const ownedGoals = await listOwnedActiveGoals(agent);
    if (ownedGoals.length === 0) return null;
    const executionPaths = await getExecutionPaths(
      agent.companyId,
      ownedGoals.map((goal) => goal.id),
    );
    const goalsWithoutExecutionPath = ownedGoals.filter(
      (goal) => !(executionPaths.get(goal.id)?.hasExecutionPath ?? false),
    );
    return {
      due: true,
      ownedActiveGoalCount: ownedGoals.length,
      goalsWithoutExecutionPathCount: goalsWithoutExecutionPath.length,
      goalsWithoutExecutionPath: goalsWithoutExecutionPath
        .slice(0, GOAL_REVIEW_WAKE_GOAL_CAP)
        .map((goal) => ({ id: goal.id, title: goal.title })),
    };
  }

  async function getGoalReviewState(agentId: string): Promise<GoalReviewRuntimeState> {
    const row = await db
      .select({ stateJson: agentRuntimeState.stateJson })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId))
      .then((rows) => rows[0] ?? null);
    return parseGoalReviewRuntimeState(row?.stateJson);
  }

  async function stampGoalReviewState(
    agent: { id: string; companyId: string; adapterType: string },
    patch: Partial<GoalReviewRuntimeState>,
  ) {
    const existing = await db
      .select({ stateJson: agentRuntimeState.stateJson })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agent.id))
      .then((rows) => rows[0] ?? null);
    if (!existing) {
      await db
        .insert(agentRuntimeState)
        .values({
          agentId: agent.id,
          companyId: agent.companyId,
          adapterType: agent.adapterType,
          stateJson: { goalReview: patch },
        })
        .onConflictDoUpdate({
          target: agentRuntimeState.agentId,
          set: {
            stateJson: sql`${agentRuntimeState.stateJson} || ${JSON.stringify({ goalReview: patch })}::jsonb`,
            updatedAt: new Date(),
          },
        });
      return;
    }
    const stateJson = (existing.stateJson ?? {}) as Record<string, unknown>;
    const goalReview = {
      ...parseGoalReviewRuntimeState(stateJson),
      ...patch,
    };
    await db
      .update(agentRuntimeState)
      .set({ stateJson: { ...stateJson, goalReview }, updatedAt: new Date() })
      .where(eq(agentRuntimeState.agentId, agent.id));
  }

  return {
    getExecutionPaths,
    listOwnedActiveGoals,
    buildGoalReview,
    buildGoalReviewWakeSummary,
    getGoalReviewState,
    stampGoalReviewState,
  };
}
