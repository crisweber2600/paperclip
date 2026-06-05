import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, issues, projectGoals, projects } from "@paperclipai/db";
import type { GoalLevel, GoalStatus, IssueStatus, ProjectStatus } from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { issueService } from "./issues.js";
import { getGoalContext, type GoalContext } from "./goals.js";

const REVIEW_GOAL_STATUSES: GoalStatus[] = ["planned", "active"];
const OPEN_ISSUE_STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked"];
const TERMINAL_ISSUE_STATUSES: IssueStatus[] = ["done", "cancelled"];

export type GoalReviewRecommendedAction =
  | "continue_existing_work"
  | "needs_planning_issue"
  | "needs_unblock"
  | "needs_delegation"
  | "no_action";

export type GoalReviewLinkedProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  goalId: string | null;
  leadAgentId: string | null;
  archivedAt: Date | null;
};

export type GoalReviewIssueSummary = {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  assigneeAgentId: string | null;
  projectId: string | null;
  updatedAt: Date;
};

export type GoalReviewItem = GoalContext & {
  linkedProjects: GoalReviewLinkedProject[];
  openIssuesByStatus: Record<IssueStatus, number>;
  openIssues: GoalReviewIssueSummary[];
  hasNonBlockedOpenIssue: boolean;
  hasIssueAssignedToCurrentAgent: boolean;
  recommendedAction: GoalReviewRecommendedAction;
};

export type EnsureGoalExecutionPathInput = {
  companyId: string;
  goalId: string;
  actorAgentId: string;
  preferredProjectId?: string | null;
};

type GoalRow = typeof goals.$inferSelect;
type IssueRow = typeof issues.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function emptyIssueStatusCounts(): Record<IssueStatus, number> {
  return {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
  };
}

function toLinkedProject(row: ProjectRow): GoalReviewLinkedProject {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ProjectStatus,
    goalId: row.goalId ?? null,
    leadAgentId: row.leadAgentId ?? null,
    archivedAt: row.archivedAt ?? null,
  };
}

function toIssueSummary(row: IssueRow): GoalReviewIssueSummary {
  return {
    id: row.id,
    identifier: row.identifier ?? null,
    title: row.title,
    status: row.status as IssueStatus,
    assigneeAgentId: row.assigneeAgentId ?? null,
    projectId: row.projectId ?? null,
    updatedAt: row.updatedAt,
  };
}

function compareGoals(a: GoalRow, b: GoalRow) {
  const levelOrder: Record<GoalLevel, number> = {
    company: 0,
    team: 1,
    agent: 2,
    task: 3,
  };
  const statusOrder: Record<GoalStatus, number> = {
    active: 0,
    planned: 1,
    achieved: 2,
    cancelled: 3,
  };
  const statusDelta = (statusOrder[a.status as GoalStatus] ?? 99) - (statusOrder[b.status as GoalStatus] ?? 99);
  if (statusDelta !== 0) return statusDelta;
  const levelDelta = (levelOrder[a.level as GoalLevel] ?? 99) - (levelOrder[b.level as GoalLevel] ?? 99);
  if (levelDelta !== 0) return levelDelta;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

async function listLedProjectGoalIds(db: Db, companyId: string, agentId: string) {
  const ledProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.leadAgentId, agentId)));
  const projectIds = ledProjects.map((project) => project.id);
  const goalIds = new Set<string>();
  for (const project of ledProjects) {
    if (project.goalId) goalIds.add(project.goalId);
  }
  if (projectIds.length > 0) {
    const links = await db
      .select({ goalId: projectGoals.goalId })
      .from(projectGoals)
      .where(and(eq(projectGoals.companyId, companyId), inArray(projectGoals.projectId, projectIds)));
    for (const link of links) goalIds.add(link.goalId);
  }
  return { ledProjects, goalIds: [...goalIds] };
}

async function listReviewGoalRows(db: Db, companyId: string, agentId: string) {
  const { goalIds: ledProjectGoalIds } = await listLedProjectGoalIds(db, companyId, agentId);
  const goalMap = new Map<string, GoalRow>();

  const [ownedGoals, companyGoals, projectGoalsRows] = await Promise.all([
    db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.companyId, companyId),
          eq(goals.ownerAgentId, agentId),
          inArray(goals.status, REVIEW_GOAL_STATUSES),
        ),
      ),
    db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.companyId, companyId),
          eq(goals.level, "company"),
          inArray(goals.status, REVIEW_GOAL_STATUSES),
        ),
      ),
    ledProjectGoalIds.length > 0
      ? db
          .select()
          .from(goals)
          .where(
            and(
              eq(goals.companyId, companyId),
              inArray(goals.id, ledProjectGoalIds),
              inArray(goals.status, REVIEW_GOAL_STATUSES),
            ),
          )
      : Promise.resolve([]),
  ]);

  for (const goal of [...ownedGoals, ...companyGoals, ...projectGoalsRows]) {
    goalMap.set(goal.id, goal);
  }

  return [...goalMap.values()].sort(compareGoals);
}

async function listLinkedProjectsByGoal(db: Db, companyId: string, goalIds: string[]) {
  const result = new Map<string, GoalReviewLinkedProject[]>();
  if (goalIds.length === 0) return result;

  const [legacyRows, joinRows] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(and(eq(projects.companyId, companyId), inArray(projects.goalId, goalIds))),
    db
      .select({ project: projects, goalId: projectGoals.goalId })
      .from(projectGoals)
      .innerJoin(projects, eq(projectGoals.projectId, projects.id))
      .where(
        and(
          eq(projectGoals.companyId, companyId),
          eq(projects.companyId, companyId),
          inArray(projectGoals.goalId, goalIds),
        ),
      ),
  ]);

  for (const project of legacyRows) {
    if (!project.goalId) continue;
    const bucket = result.get(project.goalId) ?? [];
    if (!bucket.some((entry) => entry.id === project.id)) bucket.push(toLinkedProject(project));
    result.set(project.goalId, bucket);
  }

  for (const row of joinRows) {
    const bucket = result.get(row.goalId) ?? [];
    if (!bucket.some((entry) => entry.id === row.project.id)) bucket.push(toLinkedProject(row.project));
    result.set(row.goalId, bucket);
  }

  for (const bucket of result.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

async function listOpenIssuesByGoal(db: Db, companyId: string, goalIds: string[]) {
  const result = new Map<string, IssueRow[]>();
  if (goalIds.length === 0) return result;

  const rows = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        inArray(issues.goalId, goalIds),
        isNull(issues.hiddenAt),
        inArray(issues.status, OPEN_ISSUE_STATUSES),
      ),
    )
    .orderBy(desc(issues.updatedAt), asc(issues.id));

  for (const issue of rows) {
    if (!issue.goalId) continue;
    const bucket = result.get(issue.goalId) ?? [];
    bucket.push(issue);
    result.set(issue.goalId, bucket);
  }

  return result;
}

function recommendGoalAction(openIssues: IssueRow[], agentId: string): {
  hasNonBlockedOpenIssue: boolean;
  hasIssueAssignedToCurrentAgent: boolean;
  recommendedAction: GoalReviewRecommendedAction;
} {
  const hasNonBlockedOpenIssue = openIssues.some((issue) => issue.status !== "blocked");
  const hasIssueAssignedToCurrentAgent = openIssues.some((issue) => issue.assigneeAgentId === agentId);
  const hasUnassignedNonBlockedIssue = openIssues.some(
    (issue) => issue.status !== "blocked" && !issue.assigneeAgentId && !issue.assigneeUserId,
  );

  if (openIssues.length === 0) {
    return { hasNonBlockedOpenIssue, hasIssueAssignedToCurrentAgent, recommendedAction: "needs_planning_issue" };
  }
  if (!hasNonBlockedOpenIssue) {
    return { hasNonBlockedOpenIssue, hasIssueAssignedToCurrentAgent, recommendedAction: "needs_unblock" };
  }
  if (hasIssueAssignedToCurrentAgent) {
    return { hasNonBlockedOpenIssue, hasIssueAssignedToCurrentAgent, recommendedAction: "continue_existing_work" };
  }
  if (hasUnassignedNonBlockedIssue) {
    return { hasNonBlockedOpenIssue, hasIssueAssignedToCurrentAgent, recommendedAction: "needs_delegation" };
  }
  return { hasNonBlockedOpenIssue, hasIssueAssignedToCurrentAgent, recommendedAction: "no_action" };
}

async function getPreferredLinkedProject(
  db: Db,
  companyId: string,
  goalId: string,
  preferredProjectId?: string | null,
) {
  if (preferredProjectId) {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, preferredProjectId)))
      .then((rows) => rows[0] ?? null);
    if (project) {
      const hasJoin = await db
        .select({ projectId: projectGoals.projectId })
        .from(projectGoals)
        .where(
          and(
            eq(projectGoals.companyId, companyId),
            eq(projectGoals.projectId, project.id),
            eq(projectGoals.goalId, goalId),
          ),
        )
        .then((rows) => rows.length > 0);
      if (project.goalId === goalId || hasJoin) return project;
    }
  }

  const joinProject = await db
    .select({ project: projects })
    .from(projectGoals)
    .innerJoin(projects, eq(projectGoals.projectId, projects.id))
    .where(
      and(
        eq(projectGoals.companyId, companyId),
        eq(projectGoals.goalId, goalId),
        eq(projects.companyId, companyId),
        isNull(projects.archivedAt),
        notInArray(projects.status, ["completed", "cancelled"]),
      ),
    )
    .orderBy(
      sql`case ${projects.status}
        when 'in_progress' then 0
        when 'planned' then 1
        when 'backlog' then 2
        else 3
      end`,
      asc(projects.createdAt),
    )
    .then((rows) => rows[0]?.project ?? null);
  if (joinProject) return joinProject;

  return db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.companyId, companyId),
        eq(projects.goalId, goalId),
        isNull(projects.archivedAt),
        notInArray(projects.status, ["completed", "cancelled"]),
      ),
    )
    .orderBy(
      sql`case ${projects.status}
        when 'in_progress' then 0
        when 'planned' then 1
        when 'backlog' then 2
        else 3
      end`,
      asc(projects.createdAt),
    )
    .then((rows) => rows[0] ?? null);
}

async function getExistingExecutionIssue(db: Db, companyId: string, goalId: string) {
  return db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        eq(issues.goalId, goalId),
        isNull(issues.hiddenAt),
        notInArray(issues.status, TERMINAL_ISSUE_STATUSES),
      ),
    )
    .orderBy(
      sql`case ${issues.status}
        when 'in_progress' then 0
        when 'todo' then 1
        when 'in_review' then 2
        when 'backlog' then 3
        when 'blocked' then 4
        else 5
      end`,
      desc(issues.updatedAt),
      asc(issues.id),
    )
    .then((rows) => rows[0] ?? null);
}

async function getAssigneeAgentId(db: Db, companyId: string, goal: GoalRow, actorAgentId: string) {
  const candidateIds = [goal.ownerAgentId, actorAgentId].filter((id): id is string => Boolean(id));
  for (const candidateId of candidateIds) {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, candidateId)))
      .then((rows) => rows[0] ?? null);
    if (agent) return agent.id;
  }
  return null;
}

function formatPlanningIssueDescription(goal: GoalContext, linkedProject: ProjectRow | null) {
  const description = goal.description?.trim() || "No goal description provided.";
  const ancestry = goal.ancestry.length > 0
    ? goal.ancestry.map((entry, index) => `${index + 1}. ${entry.title} (${entry.level}, ${entry.status})`).join("\n")
    : "No ancestry available.";
  const projectLine = linkedProject ? `Preferred project: ${linkedProject.name}` : "Preferred project: none";

  return [
    "Create and maintain an execution path for this goal.",
    "",
    `Goal: ${goal.title}`,
    `Level: ${goal.level}`,
    `Status: ${goal.status}`,
    `Owner agent: ${goal.ownerAgentId ?? "none"}`,
    projectLine,
    "",
    "Goal description:",
    description,
    "",
    "Goal ancestry:",
    ancestry,
    "",
    "Next action: turn this goal into concrete delegated issues or a board-approved plan without browsing unrelated unassigned work.",
  ].join("\n");
}

export function goalExecutionService(db: Db) {
  return {
    listReviewForAgent: async (input: { companyId: string; agentId: string }): Promise<GoalReviewItem[]> => {
      const agent = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)))
        .then((rows) => rows[0] ?? null);
      if (!agent) throw notFound("Agent not found");

      const goalRows = await listReviewGoalRows(db, input.companyId, input.agentId);
      const goalIds = goalRows.map((goal) => goal.id);
      const [linkedProjectsByGoal, openIssuesByGoal, contexts] = await Promise.all([
        listLinkedProjectsByGoal(db, input.companyId, goalIds),
        listOpenIssuesByGoal(db, input.companyId, goalIds),
        Promise.all(goalRows.map((goal) => getGoalContext(db, input.companyId, goal.id))),
      ]);
      const contextByGoalId = new Map<string, GoalContext>();
      for (const context of contexts) {
        if (context) contextByGoalId.set(context.id, context);
      }

      return goalRows
        .map((goal) => {
          const context = contextByGoalId.get(goal.id);
          if (!context) return null;
          const openIssueRows = openIssuesByGoal.get(goal.id) ?? [];
          const openIssuesByStatus = emptyIssueStatusCounts();
          for (const issue of openIssueRows) {
            const status = issue.status as IssueStatus;
            openIssuesByStatus[status] = (openIssuesByStatus[status] ?? 0) + 1;
          }
          const recommendation = recommendGoalAction(openIssueRows, input.agentId);
          return {
            ...context,
            linkedProjects: linkedProjectsByGoal.get(goal.id) ?? [],
            openIssuesByStatus,
            openIssues: openIssueRows.map(toIssueSummary),
            ...recommendation,
          };
        })
        .filter((entry): entry is GoalReviewItem => entry !== null);
    },

    ensureGoalExecutionPath: async (input: EnsureGoalExecutionPathInput) => {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${
            `paperclip:goal-execution-path:${input.companyId}:${input.goalId}`
          }))`,
        );

        const goal = await tx
          .select()
          .from(goals)
          .where(and(eq(goals.companyId, input.companyId), eq(goals.id, input.goalId)))
          .then((rows) => rows[0] ?? null);
        if (!goal) throw notFound("Goal not found");

        const existingIssue = await getExistingExecutionIssue(tx as unknown as Db, input.companyId, input.goalId);
        if (existingIssue) return existingIssue;

        const [goalContext, linkedProject, assigneeAgentId] = await Promise.all([
          getGoalContext(tx as unknown as Db, input.companyId, goal.id),
          getPreferredLinkedProject(tx as unknown as Db, input.companyId, goal.id, input.preferredProjectId),
          getAssigneeAgentId(tx as unknown as Db, input.companyId, goal, input.actorAgentId),
        ]);
        if (!goalContext) throw notFound("Goal not found");

        return issueService(tx as unknown as Db).create(input.companyId, {
          title: `Plan execution path for: ${goal.title}`,
          description: formatPlanningIssueDescription(goalContext, linkedProject),
          status: "todo",
          workMode: "planning",
          priority: "high",
          goalId: goal.id,
          projectId: linkedProject?.id ?? null,
          assigneeAgentId,
          createdByAgentId: input.actorAgentId,
          originKind: "goal_execution_path",
          originId: goal.id,
          originFingerprint: `goal_execution_path:${goal.id}`,
        });
      });
    },
  };
}
