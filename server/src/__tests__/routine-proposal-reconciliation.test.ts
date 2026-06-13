import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  assets,
  companies,
  companyMemberships,
  createDb,
  issues,
  issueAttachments,
  issueComments,
  issueWorkProducts,
  principalPermissionGrants,
  projects,
  routines,
  routineTriggers,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

describeEmbeddedPostgres("routine proposal reconciliation route", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routine-proposal-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(issueWorkProducts);
    await db.delete(issueAttachments);
    await db.delete(routineTriggers);
    await db.delete(routines);
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(assets);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp(actor: Record<string, unknown>, bodyByObjectKey: Map<string, string>) {
    const storage = {
      getObject: vi.fn(async (_companyId: string, objectKey: string) => ({
        stream: Readable.from([Buffer.from(bodyByObjectKey.get(objectKey) ?? "", "utf8")]),
        contentType: "application/json",
      })),
    } as any;

    const [{ issueRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/issues.js"),
      import("../middleware/index.js"),
    ]);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as typeof req & { actor?: Record<string, unknown> }).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db as any, storage));
    app.use(errorHandler);
    return app;
  }

  async function seedFixture() {
    const companyId = randomUUID();
    const userId = "board-user";
    const issueId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PAP" });
    await db.insert(projects).values({ id: projectId, companyId, name: "Operations", status: "in_progress" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Ops Agent",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      membershipRole: "owner",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Apply routines",
      status: "in_progress",
      priority: "medium",
    });
    return { companyId, issueId, projectId, agentId, userId };
  }

  it("creates a routine from an approved proposal artifact and is idempotent on reapply", async () => {
    const { companyId, issueId, projectId, agentId, userId } = await seedFixture();
    const attachmentId = randomUUID();
    const assetId = randomUUID();
    const workProductId = randomUUID();
    const objectKey = `attachments/${attachmentId}`;
    const proposal = {
      version: 1,
      companyId,
      generatedAt: new Date().toISOString(),
      sourceCorpus: { documents: [], workProducts: [], attachments: [{ id: attachmentId }] },
      defaults: { concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed" },
      proposals: [{
        proposalKey: "weekly-goal-review",
        title: "Weekly goal review",
        purpose: "Review owned goals and create follow-up execution issues.",
        assigneeAgentId: agentId,
        projectId,
        goalId: null,
        parentIssueId: issueId,
        priority: "medium",
        schedule: { kind: "schedule", cronExpression: "0 14 * * 1", timezone: "UTC" },
        variables: [],
        env: null,
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        expectedOutputs: ["issue comment"],
        wakeContract: {
          onTrigger: "create_or_reuse_execution_issue",
          onOverlap: "coalesce_into_live_issue",
          onPausedProject: "skip_without_backfill",
          onManualRun: "touch_existing_issue_for_requesting_user_if_reused",
        },
        rationale: "Derived from operating cadence described in source docs.",
        warnings: [],
      }],
      rejections: [],
      openQuestions: [],
    };
    const proposalBody = JSON.stringify(proposal);
    const bodies = new Map([[objectKey, proposalBody]]);

    await db.insert(assets).values({
      id: assetId,
      companyId,
      provider: "paperclip",
      objectKey,
      contentType: "application/json",
      byteSize: Buffer.byteLength(proposalBody),
      sha256: createHash("sha256").update(proposalBody).digest("hex"),
      originalFilename: "proposal.json",
    });
    await db.insert(issueAttachments).values({ id: attachmentId, companyId, issueId, assetId });
    await db.insert(issueWorkProducts).values({
      id: workProductId,
      companyId,
      issueId,
      type: "artifact",
      provider: "paperclip",
      title: "Approved routine proposal",
      status: "ready_for_review",
      reviewState: "none",
      isPrimary: true,
      healthStatus: "unknown",
      metadata: {
        attachmentId,
        contentPath: `/api/attachments/${attachmentId}/content`,
        openPath: `/api/attachments/${attachmentId}/content`,
        downloadPath: `/api/attachments/${attachmentId}/content?download=1`,
        originalFilename: "proposal.json",
        contentType: "application/json",
      },
    });

    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    }, bodies);

    const first = await request(app).post(`/api/issues/${issueId}/routine-proposals/apply`).send({ workProductId });
    expect(first.status).toBe(200);
    expect(first.body.summary).toEqual({ created: 1, updated: 0, unchanged: 0, rejected: 0 });

    const second = await request(app).post(`/api/issues/${issueId}/routine-proposals/apply`).send({ workProductId });
    expect(second.status).toBe(200);
    expect(second.body.summary).toEqual({ created: 0, updated: 0, unchanged: 1, rejected: 0 });

    const routineRows = await db.select().from(routines).where(eq(routines.parentIssueId, issueId));
    expect(routineRows).toHaveLength(1);
    const triggerRows = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routineRows[0]!.id));
    expect(triggerRows).toHaveLength(1);
    expect(triggerRows[0]).toMatchObject({ kind: "schedule", cronExpression: "0 14 * * 1", timezone: "UTC" });

    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments.length).toBeGreaterThanOrEqual(2);
  });
});
