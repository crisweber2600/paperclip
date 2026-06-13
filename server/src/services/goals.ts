import { and, asc, count, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, issues, projectGoals, projects } from "@paperclipai/db";
import type { GoalExecutionPath } from "@paperclipai/shared";

type GoalReader = Pick<Db, "select">;
type GoalOperatorRow = typeof goals.$inferSelect & {
  executionPath: GoalExecutionPath;
  needsPlanning: boolean;
};

// Goal trees are semantically at most company > team > agent > task deep;
// the cap only guards against pathological chains.
export const MAX_GOAL_ANCESTOR_DEPTH = 8;
const TERMINAL_ISSUE_STATUSES = ["done", "cancelled"];
const OPEN_PROJECT_STATUSES = ["backlog", "planned", "in_progress"];

export function parseAcceptanceCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

async function walkGoalAncestors(
  db: GoalReader,
  input: {
    companyId: string;
    parentId: string | null;
    visited: Set<string>;
  },
) {
  const ancestors: (typeof goals.$inferSelect)[] = [];
  let parentId = input.parentId;
  while (parentId && !input.visited.has(parentId) && ancestors.length < MAX_GOAL_ANCESTOR_DEPTH) {
    const parent = await db
      .select()
      .from(goals)
      .where(and(eq(goals.companyId, input.companyId), eq(goals.id, parentId)))
      .then((rows) => rows[0] ?? null);
    if (!parent) break;
    ancestors.push(parent);
    input.visited.add(parent.id);
    parentId = parent.parentId;
  }
  return ancestors;
}

export async function getGoalAncestors(db: GoalReader, goalId: string) {
  const goal = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .then((rows) => rows[0] ?? null);
  if (!goal) return [];

  return walkGoalAncestors(db, {
    companyId: goal.companyId,
    parentId: goal.parentId,
    visited: new Set<string>([goal.id]),
  });
}

export function getGoalAncestorsFromParent(
  db: GoalReader,
  input: {
    companyId: string;
    parentId: string | null;
    goalId?: string;
  },
) {
  return walkGoalAncestors(db, {
    companyId: input.companyId,
    parentId: input.parentId,
    visited: new Set<string>(input.goalId ? [input.goalId] : []),
  });
}

export async function getDefaultCompanyGoal(db: GoalReader, companyId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.companyId, companyId), eq(goals.level, "company")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

export async function getGoalExecutionPaths(
  db: Db,
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
          eq(projects.companyId, companyId),
          inArray(projectGoals.goalId, goalIds),
          inArray(projects.status, OPEN_PROJECT_STATUSES),
        ),
      ),
  ]);

  for (const row of issueRows) {
    if (!row.goalId) continue;
    const entry = result.get(row.goalId);
    if (!entry) continue;
    entry.openIssueCount = Number(row.openIssueCount ?? 0);
    entry.hasExecutionPath = entry.openIssueCount > 0 || entry.openProjectCount > 0;
  }

  const linkedProjectIdsByGoal = new Map<string, Set<string>>();
  for (const row of legacyProjectRows) {
    if (!row.goalId) continue;
    const set = linkedProjectIdsByGoal.get(row.goalId) ?? new Set<string>();
    set.add(row.projectId);
    linkedProjectIdsByGoal.set(row.goalId, set);
  }
  for (const row of linkedProjectRows) {
    const set = linkedProjectIdsByGoal.get(row.goalId) ?? new Set<string>();
    set.add(row.projectId);
    linkedProjectIdsByGoal.set(row.goalId, set);
  }

  for (const [goalId, projectIds] of linkedProjectIdsByGoal.entries()) {
    const entry = result.get(goalId);
    if (!entry) continue;
    entry.openProjectCount = projectIds.size;
    entry.hasExecutionPath = entry.openIssueCount > 0 || entry.openProjectCount > 0;
  }

  return result;
}

export async function enrichGoalsWithOperatorState(
  db: Db,
  baseGoals: (typeof goals.$inferSelect)[],
): Promise<GoalOperatorRow[]> {
  if (baseGoals.length === 0) return [];
  const companyId = baseGoals[0]!.companyId;
  const executionPaths = await getGoalExecutionPaths(
    db,
    companyId,
    baseGoals.map((goal) => goal.id),
  );

  return baseGoals.map((goal) => {
    const executionPath =
      executionPaths.get(goal.id) ??
      ({ openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false } satisfies GoalExecutionPath);
    return {
      id: goal.id,
      companyId: goal.companyId,
      title: goal.title,
      description: goal.description,
      level: goal.level,
      status: goal.status,
      parentId: goal.parentId,
      ownerAgentId: goal.ownerAgentId,
      acceptanceCriteria: goal.acceptanceCriteria,
      lastVerdict: goal.lastVerdict,
      lastVerdictReason: goal.lastVerdictReason,
      lastVerdictAt: goal.lastVerdictAt,
      lastVerdictByAgentId: goal.lastVerdictByAgentId,
      verdictStreak: goal.verdictStreak,
      pauseReason: goal.pauseReason,
      pausedAt: goal.pausedAt,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      executionPath,
      needsPlanning: goal.status === "active" && !executionPath.hasExecutionPath,
    } satisfies GoalOperatorRow;
  });
}

export function goalService(db: Db) {
  return {
    list: (companyId: string) => db.select().from(goals).where(eq(goals.companyId, companyId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    listOperatorView: async (companyId: string) => {
      const rows = await db.select().from(goals).where(eq(goals.companyId, companyId));
      return enrichGoalsWithOperatorState(db, rows);
    },

    getOperatorById: async (id: string) => {
      const goal = await db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!goal) return null;
      const [enriched] = await enrichGoalsWithOperatorState(db, [goal]);
      return enriched ?? null;
    },

    getDefaultCompanyGoal: (companyId: string) => getDefaultCompanyGoal(db, companyId),

    getAncestors: (goalId: string) => getGoalAncestors(db, goalId),
    getAncestorsFromParent: (companyId: string, parentId: string | null, goalId?: string) =>
      getGoalAncestorsFromParent(db, { companyId, parentId, goalId }),

    listActiveOwnedByAgent: (
      companyId: string,
      agentId: string,
      opts?: { includeUnownedCompanyLevel?: boolean },
    ) =>
      db
        .select()
        .from(goals)
        .where(
          and(
            eq(goals.companyId, companyId),
            eq(goals.status, "active"),
            opts?.includeUnownedCompanyLevel
              ? or(
                  eq(goals.ownerAgentId, agentId),
                  and(eq(goals.level, "company"), isNull(goals.ownerAgentId)),
                )
              : eq(goals.ownerAgentId, agentId),
          ),
        )
        .orderBy(asc(goals.createdAt)),

    create: (companyId: string, data: Omit<typeof goals.$inferInsert, "companyId">) =>
      db
        .insert(goals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    // Records an agent-posted (or, with byAgentId null, a future server-judge)
    // goal verdict. The streak counts consecutive identical verdicts and is the
    // turn-budget analog: review escalation stops once it exceeds the cap.
    // The streak is updated atomically in SQL to prevent lost increments under
    // concurrent requests.
    recordVerdict: async (
      id: string,
      input: { verdict: string; reason: string; byAgentId: string | null; now?: Date },
    ) => {
      const now = input.now ?? new Date();
      return db
        .update(goals)
        .set({
          lastVerdict: input.verdict,
          lastVerdictReason: input.reason,
          lastVerdictAt: now,
          lastVerdictByAgentId: input.byAgentId,
          verdictStreak: sql`CASE WHEN ${goals.lastVerdict} = ${input.verdict} THEN ${goals.verdictStreak} + 1 ELSE 1 END`,
          updatedAt: now,
        })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    update: (id: string, data: Partial<typeof goals.$inferInsert>) =>
      db
        .update(goals)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    getExecutionPaths: (companyId: string, goalIds: string[]) => getGoalExecutionPaths(db, companyId, goalIds),
    enrichGoals: (baseGoals: (typeof goals.$inferSelect)[]) => enrichGoalsWithOperatorState(db, baseGoals),
  };
}
