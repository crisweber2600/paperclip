import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals } from "@paperclipai/db";

type GoalReader = Pick<Db, "select">;
type GoalRow = typeof goals.$inferSelect;

export type GoalContextRef = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  level: string;
  parentId: string | null;
  ownerAgentId: string | null;
};

export type GoalContext = GoalContextRef & {
  ancestry: GoalContextRef[];
  childGoalCount: number;
};

const MAX_GOAL_ANCESTRY_DEPTH = 32;

function toGoalContextRef(row: GoalRow): GoalContextRef {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    level: row.level,
    parentId: row.parentId ?? null,
    ownerAgentId: row.ownerAgentId ?? null,
  };
}

async function getGoalByIdForCompany(db: GoalReader, companyId: string, id: string) {
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.companyId, companyId)))
    .then((rows) => rows[0] ?? null);
}

export async function getGoalAncestry(db: GoalReader, companyId: string, goalId: string): Promise<GoalContextRef[]> {
  const chain: GoalRow[] = [];
  const seen = new Set<string>();
  let current = await getGoalByIdForCompany(db, companyId, goalId);

  for (let depth = 0; current && depth < MAX_GOAL_ANCESTRY_DEPTH; depth += 1) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.unshift(current);
    if (!current.parentId) break;
    current = await getGoalByIdForCompany(db, companyId, current.parentId);
  }

  return chain.map(toGoalContextRef);
}

export async function getGoalContext(db: GoalReader, companyId: string, goalId: string): Promise<GoalContext | null> {
  const goal = await getGoalByIdForCompany(db, companyId, goalId);
  if (!goal) return null;

  const [ancestry, childCountRow] = await Promise.all([
    getGoalAncestry(db, companyId, goal.id),
    db
      .select({ childGoalCount: sql<number>`count(*)::int` })
      .from(goals)
      .where(and(eq(goals.companyId, companyId), eq(goals.parentId, goal.id)))
      .then((rows) => rows[0] ?? { childGoalCount: 0 }),
  ]);

  return {
    ...toGoalContextRef(goal),
    ancestry,
    childGoalCount: childCountRow.childGoalCount ?? 0,
  };
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

    getByIdForCompany: (companyId: string, id: string) => getGoalByIdForCompany(db, companyId, id),

    getDefaultCompanyGoal: (companyId: string) => getDefaultCompanyGoal(db, companyId),

    getAncestry: (companyId: string, goalId: string) => getGoalAncestry(db, companyId, goalId),

    getContext: (companyId: string, goalId: string) => getGoalContext(db, companyId, goalId),

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
