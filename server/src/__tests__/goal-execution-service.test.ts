import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  goals,
  instanceSettings,
  issues,
  projectGoals,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { goalExecutionService } from "../services/goal-execution.ts";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres goal execution tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function issuePrefix(seed: string) {
  return `G${seed.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

async function seedCompany(db: ReturnType<typeof createDb>, name = "Paperclip") {
  const id = randomUUID();
  await db.insert(companies).values({
    id,
    name,
    issuePrefix: issuePrefix(id),
    requireBoardApprovalForNewAgents: false,
  });
  return id;
}

async function seedAgent(
  db: ReturnType<typeof createDb>,
  companyId: string,
  input: { name: string; role: string; reportsTo?: string | null },
) {
  const id = randomUUID();
  await db.insert(agents).values({
    id,
    companyId,
    name: input.name,
    role: input.role,
    title: input.name,
    reportsTo: input.reportsTo ?? null,
    status: "idle",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  });
  return id;
}

async function seedGoal(
  db: ReturnType<typeof createDb>,
  companyId: string,
  input: {
    title: string;
    description?: string | null;
    level?: string;
    status?: string;
    parentId?: string | null;
    ownerAgentId?: string | null;
  },
) {
  const [goal] = await db
    .insert(goals)
    .values({
      companyId,
      title: input.title,
      description: input.description ?? null,
      level: input.level ?? "company",
      status: input.status ?? "active",
      parentId: input.parentId ?? null,
      ownerAgentId: input.ownerAgentId ?? null,
    })
    .returning();
  return goal;
}

async function seedProject(
  db: ReturnType<typeof createDb>,
  companyId: string,
  input: { name: string; goalId?: string | null; leadAgentId?: string | null; useJoin?: boolean },
) {
  const [project] = await db
    .insert(projects)
    .values({
      companyId,
      name: input.name,
      status: "in_progress",
      goalId: input.goalId ?? null,
      leadAgentId: input.leadAgentId ?? null,
    })
    .returning();
  if (input.useJoin && input.goalId) {
    await db.insert(projectGoals).values({
      companyId,
      projectId: project.id,
      goalId: input.goalId,
    });
  }
  return project;
}

describeEmbeddedPostgres("goalExecutionService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-goal-execution-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectGoals);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns CEO-owned active goals with no issues as needing a planning issue", async () => {
    const companyId = await seedCompany(db);
    const ceoId = await seedAgent(db, companyId, { name: "CEO", role: "ceo" });
    const ctoId = await seedAgent(db, companyId, { name: "CTO", role: "engineer", reportsTo: ceoId });
    const companyGoal = await seedGoal(db, companyId, {
      title: "Win the market",
      description: "Company mission",
      level: "company",
    });
    const ceoOwnedGoal = await seedGoal(db, companyId, {
      title: "Create the launch plan",
      description: "CEO-owned execution goal",
      level: "agent",
      parentId: companyGoal.id,
      ownerAgentId: ceoId,
    });
    const otherOwnedGoal = await seedGoal(db, companyId, {
      title: "Implement product slice",
      level: "agent",
      parentId: companyGoal.id,
      ownerAgentId: ctoId,
    });

    const review = await goalExecutionService(db).listReviewForAgent({ companyId, agentId: ceoId });

    expect(review.map((goal) => goal.id)).toContain(companyGoal.id);
    expect(review.map((goal) => goal.id)).toContain(ceoOwnedGoal.id);
    expect(review.map((goal) => goal.id)).not.toContain(otherOwnedGoal.id);
    expect(review.find((goal) => goal.id === ceoOwnedGoal.id)).toEqual(expect.objectContaining({
      description: "CEO-owned execution goal",
      recommendedAction: "needs_planning_issue",
      hasNonBlockedOpenIssue: false,
      hasIssueAssignedToCurrentAgent: false,
      ancestry: [
        expect.objectContaining({ id: companyGoal.id }),
        expect.objectContaining({ id: ceoOwnedGoal.id }),
      ],
    }));
  });

  it("includes active goals linked to CEO-led projects and marks unassigned work for delegation", async () => {
    const companyId = await seedCompany(db);
    const ceoId = await seedAgent(db, companyId, { name: "CEO", role: "ceo" });
    const projectGoal = await seedGoal(db, companyId, {
      title: "Launch project",
      level: "team",
      description: "Project execution goal",
    });
    const project = await seedProject(db, companyId, {
      name: "Launch",
      goalId: projectGoal.id,
      leadAgentId: ceoId,
      useJoin: true,
    });
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId: project.id,
        goalId: projectGoal.id,
        title: "Split the launch work",
        status: "todo",
        workMode: "planning",
        priority: "high",
      })
      .returning();

    const review = await goalExecutionService(db).listReviewForAgent({ companyId, agentId: ceoId });
    const item = review.find((goal) => goal.id === projectGoal.id);

    expect(item).toEqual(expect.objectContaining({
      id: projectGoal.id,
      linkedProjects: [
        expect.objectContaining({ id: project.id, name: "Launch", leadAgentId: ceoId }),
      ],
      openIssuesByStatus: expect.objectContaining({ todo: 1 }),
      openIssues: [
        expect.objectContaining({ id: issue.id, status: "todo", assigneeAgentId: null }),
      ],
      hasNonBlockedOpenIssue: true,
      hasIssueAssignedToCurrentAgent: false,
      recommendedAction: "needs_delegation",
    }));
  });

  it("keeps goal review and ancestry company-scoped", async () => {
    const companyId = await seedCompany(db, "Paperclip A");
    const foreignCompanyId = await seedCompany(db, "Paperclip B");
    const ceoId = await seedAgent(db, companyId, { name: "CEO", role: "ceo" });
    await seedAgent(db, foreignCompanyId, { name: "Foreign CEO", role: "ceo" });
    const foreignRoot = await seedGoal(db, foreignCompanyId, {
      title: "Foreign mission",
      level: "company",
    });
    const ownedGoalWithForeignParent = await seedGoal(db, companyId, {
      title: "Local child",
      level: "agent",
      parentId: foreignRoot.id,
      ownerAgentId: ceoId,
    });

    const review = await goalExecutionService(db).listReviewForAgent({ companyId, agentId: ceoId });

    expect(review.map((goal) => goal.id)).toContain(ownedGoalWithForeignParent.id);
    expect(review.map((goal) => goal.id)).not.toContain(foreignRoot.id);
    const localGoal = review.find((goal) => goal.id === ownedGoalWithForeignParent.id);
    expect(localGoal?.ancestry).toEqual([
      expect.objectContaining({ id: ownedGoalWithForeignParent.id, title: "Local child" }),
    ]);
    expect(JSON.stringify(review)).not.toContain("Foreign mission");
  });

  it("creates exactly one goal-linked planning issue for an uncovered goal", async () => {
    const companyId = await seedCompany(db);
    const ceoId = await seedAgent(db, companyId, { name: "CEO", role: "ceo" });
    const goal = await seedGoal(db, companyId, {
      title: "Create the operating plan",
      description: "Operationalize the mission.",
      ownerAgentId: ceoId,
    });
    const project = await seedProject(db, companyId, {
      name: "Operations",
      goalId: goal.id,
      leadAgentId: ceoId,
      useJoin: true,
    });

    const first = await goalExecutionService(db).ensureGoalExecutionPath({
      companyId,
      goalId: goal.id,
      actorAgentId: ceoId,
      preferredProjectId: project.id,
    });
    const second = await goalExecutionService(db).ensureGoalExecutionPath({
      companyId,
      goalId: goal.id,
      actorAgentId: ceoId,
      preferredProjectId: project.id,
    });
    const rows = await db.select().from(issues).where(eq(issues.goalId, goal.id));

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id: first.id,
      goalId: goal.id,
      projectId: project.id,
      assigneeAgentId: ceoId,
      status: "todo",
      workMode: "planning",
      originKind: "goal_execution_path",
      originId: goal.id,
    }));
    expect(rows[0].title).toBe("Plan execution path for: Create the operating plan");
    expect(rows[0].description).toContain("Operationalize the mission.");
    expect(rows[0].description).toContain("Goal ancestry:");
  });

  it("preserves goalId on child issues created from a goal-linked planning issue", async () => {
    const companyId = await seedCompany(db);
    const ceoId = await seedAgent(db, companyId, { name: "CEO", role: "ceo" });
    const goal = await seedGoal(db, companyId, {
      title: "Delegate launch tasks",
      ownerAgentId: ceoId,
    });
    const parent = await issueService(db).create(companyId, {
      title: "Plan execution path for: Delegate launch tasks",
      description: "Plan the goal path.",
      status: "todo",
      workMode: "planning",
      priority: "high",
      goalId: goal.id,
      assigneeAgentId: ceoId,
      createdByAgentId: ceoId,
    });

    const child = await issueService(db).createChild(parent.id, {
      title: "Delegate implementation slice",
      description: "Carry out the first slice.",
      status: "todo",
      workMode: "standard",
      priority: "medium",
      assigneeAgentId: ceoId,
      createdByAgentId: ceoId,
    });

    expect(child.issue.goalId).toBe(goal.id);
  });
});
