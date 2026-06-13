import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentRuntimeState } from "@paperclipai/db";
import {
  goalReviewRuntimeStateSchema,
  goalReviewWakeContextSchema,
  type GoalReviewRuntimeState,
  type GoalReviewWakeContext,
} from "@paperclipai/shared";
import { goalService, parseAcceptanceCriteria } from "./goals.js";

export const DEFAULT_GOAL_REVIEW_INTERVAL_HOURS = 4;
// Tighter cadence while the owner has stalled/blocked goals needing attention.
export const DEFAULT_GOAL_REVIEW_STALLED_INTERVAL_HOURS = 1;
// Hermes-style turn budget: consecutive stalled/blocked verdicts on the same
// goal stop escalating once the streak reaches this cap.
export const DEFAULT_GOAL_REVIEW_MAX_VERDICT_STREAK = 6;
export const GOAL_REVIEW_WAKE_GOAL_CAP = 5;

export function getGoalReviewIntervalHours() {
  const raw = Number(process.env.PAPERCLIP_GOAL_REVIEW_INTERVAL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOAL_REVIEW_INTERVAL_HOURS;
}

export function getGoalReviewStalledIntervalHours() {
  const raw = Number(process.env.PAPERCLIP_GOAL_REVIEW_STALLED_INTERVAL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOAL_REVIEW_STALLED_INTERVAL_HOURS;
}

export function getGoalReviewMaxVerdictStreak() {
  const raw = Number(process.env.PAPERCLIP_GOAL_REVIEW_MAX_VERDICT_STREAK);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOAL_REVIEW_MAX_VERDICT_STREAK;
}

const ATTENTION_VERDICTS = new Set(["stalled", "blocked"]);

export function isAttentionGoal(goal: { lastVerdict: string | null; verdictStreak: number }) {
  return (
    goal.lastVerdict !== null &&
    ATTENTION_VERDICTS.has(goal.lastVerdict) &&
    goal.verdictStreak < getGoalReviewMaxVerdictStreak()
  );
}

export function parseGoalReviewRuntimeState(stateJson: unknown): GoalReviewRuntimeState {
  if (!stateJson || typeof stateJson !== "object") return {};
  const raw = (stateJson as Record<string, unknown>).goalReview;
  const parsed = goalReviewRuntimeStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function isGoalReviewDue(input: {
  state: GoalReviewRuntimeState;
  now: Date;
  intervalHours?: number;
}) {
  const defaultIntervalHours =
    (input.state.attentionGoalCount ?? 0) > 0
      ? getGoalReviewStalledIntervalHours()
      : getGoalReviewIntervalHours();
  const intervalMs = (input.intervalHours ?? defaultIntervalHours) * 60 * 60 * 1000;
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

  async function listOwnedActiveGoals(agent: { id: string; companyId: string; role: string }) {
    return goalsSvc.listActiveOwnedByAgent(agent.companyId, agent.id, {
      // The CEO is also accountable for active company-level goals nobody owns.
      includeUnownedCompanyLevel: agent.role === "ceo",
    });
  }

  async function buildGoalReview(agent: { id: string; companyId: string; role: string }) {
    const ownedGoals = await listOwnedActiveGoals(agent);
    const executionPaths = await goalsSvc.getExecutionPaths(
      agent.companyId,
      ownedGoals.map((goal) => goal.id),
    );
    const ancestorsByGoal = await Promise.all(
      ownedGoals.map((goal) => goalsSvc.getAncestors(goal.id)),
    );
    const now = new Date();
    const verdictStaleMs = getGoalReviewIntervalHours() * 60 * 60 * 1000;
    return ownedGoals.map((goal, index) => {
      const executionPath = executionPaths.get(goal.id) ?? {
        openIssueCount: 0,
        openProjectCount: 0,
        hasExecutionPath: false,
      };
      return {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        level: goal.level,
        status: goal.status,
        parentId: goal.parentId,
        ownerAgentId: goal.ownerAgentId,
        acceptanceCriteria: parseAcceptanceCriteria(goal.acceptanceCriteria),
        lastVerdict: goal.lastVerdict,
        lastVerdictReason: goal.lastVerdictReason,
        lastVerdictAt: goal.lastVerdictAt,
        verdictStreak: goal.verdictStreak,
        verdictStale:
          !goal.lastVerdictAt || now.getTime() - goal.lastVerdictAt.getTime() > verdictStaleMs,
        pausedAt: goal.pausedAt,
        pauseReason: goal.pauseReason,
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
    const executionPaths = await goalsSvc.getExecutionPaths(
      agent.companyId,
      ownedGoals.map((goal) => goal.id),
    );
    const goalsWithoutExecutionPath = ownedGoals.filter(
      (goal) => !(executionPaths.get(goal.id)?.hasExecutionPath ?? false),
    );
    // Goals whose last verdict was stalled/blocked and still under the streak
    // cap; exhausted goals drop out, which is the turn-budget enforcement.
    const attentionGoals = ownedGoals.filter(isAttentionGoal);
    return goalReviewWakeContextSchema.parse({
      due: true,
      ownedActiveGoalCount: ownedGoals.length,
      goalsWithoutExecutionPathCount: goalsWithoutExecutionPath.length,
      goalsWithoutExecutionPath: goalsWithoutExecutionPath
        .slice(0, GOAL_REVIEW_WAKE_GOAL_CAP)
        .map((goal) => ({ id: goal.id, title: goal.title })),
      attentionGoalCount: attentionGoals.length,
      attentionGoals: attentionGoals.slice(0, GOAL_REVIEW_WAKE_GOAL_CAP).map((goal) => ({
        id: goal.id,
        title: goal.title,
        lastVerdict: goal.lastVerdict,
        verdictStreak: goal.verdictStreak,
      })),
    });
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
    getExecutionPaths: (companyId: string, goalIds: string[]) =>
      goalsSvc.getExecutionPaths(companyId, goalIds),
    listOwnedActiveGoals,
    buildGoalReview,
    buildGoalReviewWakeSummary,
    getGoalReviewState,
    stampGoalReviewState,
  };
}
