import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals } from "@paperclipai/db";

type GoalReader = Pick<Db, "select">;

// Goal trees are semantically at most company > team > agent > task deep;
// the cap only guards against pathological chains.
export const MAX_GOAL_ANCESTOR_DEPTH = 8;

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

export function goalService(db: Db) {
  return {
    list: (companyId: string) => db.select().from(goals).where(eq(goals.companyId, companyId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

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
  };
}
