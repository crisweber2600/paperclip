import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const mockAgent = vi.hoisted(() => ({
  id: "22222222-2222-4222-8222-222222222222",
  companyId: "11111111-1111-4111-8111-111111111111",
  name: "CEO Agent",
  role: "ceo",
  adapterType: "process",
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockGoalReviewService = vi.hoisted(() => ({
  buildGoalReview: vi.fn(),
  getGoalReviewState: vi.fn(),
  stampGoalReviewState: vi.fn(),
  listOwnedActiveGoals: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  recordVerdict: vi.fn(),
  update: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  listDependencyReadiness: vi.fn(),
}));

const mockIssueRecoveryActionService = vi.hoisted(() => ({
  listActiveForIssues: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => ({}),
  accessService: () => ({}),
  approvalService: () => ({}),
  companySkillService: () => ({}),
  budgetService: () => ({}),
  getGoalReviewIntervalHours: () => 4,
  getGoalReviewMaxVerdictStreak: () => 6,
  isAttentionGoal: (goal: { lastVerdict: string | null; verdictStreak: number }) =>
    goal.lastVerdict !== null &&
    ["stalled", "blocked"].includes(goal.lastVerdict) &&
    goal.verdictStreak < 6,
  goalReviewService: () => mockGoalReviewService,
  goalService: () => mockGoalService,
  heartbeatService: () => ({ wakeup: vi.fn(async () => undefined) }),
  ISSUE_LIST_DEFAULT_LIMIT: 200,
  issueApprovalService: () => ({}),
  issueRecoveryActionService: () => mockIssueRecoveryActionService,
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  syncInstructionsBundleConfigFromFilePath: vi.fn(),
  workspaceOperationService: () => ({}),
}));

vi.mock("../services/environments.js", () => ({ environmentService: () => ({}) }));
vi.mock("../services/environment-runtime.js", () => ({ environmentRuntimeService: () => ({}) }));
vi.mock("../services/secrets.js", () => ({ secretService: () => ({}) }));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({}) }));
vi.mock("../services/recovery/service.js", () => ({ recoveryService: () => ({}) }));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

function agentActor() {
  return {
    type: "agent",
    agentId: AGENT_ID,
    companyId: COMPANY_ID,
    companyIds: [COMPANY_ID],
    source: "agent_jwt",
    isInstanceAdmin: false,
  };
}

const reviewGoals = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Ship V1",
    description: "Launch the first version",
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: AGENT_ID,
    acceptanceCriteria: ["Launch the first version"],
    lastVerdict: null,
    lastVerdictReason: null,
    lastVerdictAt: null,
    verdictStreak: 0,
    verdictStale: true,
    pausedAt: null,
    pauseReason: null,
    ancestors: [],
    executionPath: { openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false },
    needsPlanning: true,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Grow revenue",
    description: null,
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: AGENT_ID,
    acceptanceCriteria: ["Increase revenue"],
    lastVerdict: "progressing",
    lastVerdictReason: "moving",
    lastVerdictAt: "2026-06-09T08:00:00.000Z",
    verdictStreak: 1,
    verdictStale: false,
    pausedAt: null,
    pauseReason: null,
    ancestors: [],
    executionPath: { openIssueCount: 2, openProjectCount: 1, hasExecutionPath: true },
    needsPlanning: false,
  },
];

describe.sequential("agent goal review routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue(mockAgent);
    mockGoalReviewService.buildGoalReview.mockResolvedValue(reviewGoals);
    mockGoalReviewService.listOwnedActiveGoals.mockResolvedValue([]);
    mockGoalReviewService.getGoalReviewState.mockResolvedValue({
      lastCheckedAt: "2026-06-09T06:00:00.000Z",
    });
    mockGoalReviewService.stampGoalReviewState.mockResolvedValue(undefined);
    mockGoalService.update.mockResolvedValue({
      id: reviewGoals[0].id,
      status: "achieved",
    });
    mockIssueService.create.mockResolvedValue({
      id: "88888888-8888-4888-8888-888888888888",
      identifier: "PAP-99",
      title: "Plan: Ship V1",
    });
    mockDb.select.mockReset();
  });

  it("requires agent authentication", async () => {
    const res = await request(
      createApp({
        type: "board",
        userId: "local-board",
        companyIds: [COMPANY_ID],
        source: "local_implicit",
        isInstanceAdmin: false,
      }),
    ).get("/api/agents/me/goal-review");

    expect(res.status).toBe(401);
    expect(mockGoalReviewService.buildGoalReview).not.toHaveBeenCalled();
  });

  it("returns owned goals with execution-path status and records the review", async () => {
    const res = await request(createApp(agentActor())).get("/api/agents/me/goal-review");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        intervalHours: 4,
        lastReviewedAt: "2026-06-09T06:00:00.000Z",
      }),
    );
    expect(res.body.goals).toHaveLength(2);
    expect(res.body.goals[0]).toEqual(
      expect.objectContaining({
        id: reviewGoals[0].id,
        description: "Launch the first version",
        needsPlanning: true,
      }),
    );

    expect(mockGoalReviewService.buildGoalReview).toHaveBeenCalledWith(mockAgent);
    expect(mockGoalReviewService.stampGoalReviewState).toHaveBeenCalledWith(
      mockAgent,
      expect.objectContaining({ lastCheckedAt: expect.any(String) }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        action: "agent.goal_review_checked",
        actorType: "agent",
        actorId: AGENT_ID,
        entityType: "agent",
        entityId: AGENT_ID,
        details: expect.objectContaining({
          goalCount: 2,
          needsPlanningGoalIds: [reviewGoals[0].id],
        }),
      }),
    );
  });

  it("returns 404 when the agent record is missing", async () => {
    mockAgentService.getById.mockResolvedValue(null);
    const res = await request(createApp(agentActor())).get("/api/agents/me/goal-review");
    expect(res.status).toBe(404);
  });

  it("rejects verdicts for goals the agent does not own", async () => {
    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({
        verdicts: [
          { goalId: "99999999-9999-4999-8999-999999999999", verdict: "stalled", reason: "not mine" },
        ],
      });

    expect(res.status).toBe(422);
    expect(mockGoalService.recordVerdict).not.toHaveBeenCalled();
  });

  it("rejects invalid verdict values", async () => {
    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId: reviewGoals[0].id, verdict: "meh", reason: "?" }] });

    expect(res.status).toBe(400);
    expect(mockGoalService.recordVerdict).not.toHaveBeenCalled();
  });

  it("requires a concrete lack-of-progress reason for stalled verdicts", async () => {
    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId: reviewGoals[0].id, verdict: "stalled", reason: "investigating" }] });

    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("Stalled goal-review verdicts require");
    expect(mockGoalService.recordVerdict).not.toHaveBeenCalled();
  });

  it("requires a dependency path or unblock owner for blocked verdicts", async () => {
    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId: reviewGoals[0].id, verdict: "blocked", reason: "hard problem" }] });

    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("Blocked goal-review verdicts require");
    expect(mockGoalService.recordVerdict).not.toHaveBeenCalled();
  });

  it("records verdicts, logs activity, and stamps attention state", async () => {
    const goalId = reviewGoals[0].id;
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve([])),
        })),
      })),
    });
    mockGoalReviewService.listOwnedActiveGoals.mockResolvedValue([
      { id: goalId, lastVerdict: "stalled", verdictStreak: 2 },
    ]);
    mockGoalService.recordVerdict.mockResolvedValue({
      id: goalId,
      verdictStreak: 2,
    });

    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId, verdict: "stalled", reason: "no movement since last review" }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        agentId: AGENT_ID,
        recordedCount: 1,
        attentionGoalCount: 1,
        planningIssues: [
          expect.objectContaining({ goalId, issueId: "88888888-8888-4888-8888-888888888888", reused: false }),
        ],
        results: [
          expect.objectContaining({ goalId, verdict: "stalled", verdictStreak: 2 }),
        ],
      }),
    );
    expect(mockGoalService.recordVerdict).toHaveBeenCalledWith(
      goalId,
      expect.objectContaining({
        verdict: "stalled",
        reason: "no movement since last review",
        byAgentId: AGENT_ID,
      }),
    );
    expect(mockIssueService.create).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        title: "Plan: Ship V1",
        goalId,
        workMode: "planning",
        assigneeAgentId: AGENT_ID,
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        action: "goal.verdict_recorded",
        entityType: "goal",
        entityId: goalId,
        details: expect.objectContaining({
          verdict: "stalled",
          verdictStreak: 2,
          source: "owner_review",
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        action: "goal.review_planning_issue_ensured",
        entityType: "goal",
        entityId: goalId,
        details: expect.objectContaining({ issueIdentifier: "PAP-99", reused: false }),
      }),
    );
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ action: "goal.review_attention_exhausted" }),
    );
    expect(mockGoalReviewService.stampGoalReviewState).toHaveBeenCalledWith(
      mockAgent,
      expect.objectContaining({
        lastEvaluatedAt: expect.any(String),
        attentionGoalCount: 1,
      }),
    );
  });

  it("marks goals achieved immediately for done verdicts", async () => {
    const goalId = reviewGoals[1].id;
    mockGoalService.update.mockResolvedValue({
      id: goalId,
      status: "achieved",
    });
    mockGoalReviewService.buildGoalReview.mockResolvedValue([
      {
        ...reviewGoals[1],
        status: "active",
        needsPlanning: false,
      },
    ]);
    mockGoalReviewService.listOwnedActiveGoals.mockResolvedValue([]);
    mockGoalService.recordVerdict.mockResolvedValue({
      id: goalId,
      verdictStreak: 2,
    });

    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId, verdict: "done", reason: "explicit evidence in linked issues and artifacts" }] });

    expect(res.status).toBe(200);
    expect(mockGoalService.update).toHaveBeenCalledWith(goalId, { status: "achieved" });
    expect(mockLogActivity.mock.calls).toEqual(
      expect.arrayContaining([
        [
          mockDb,
          expect.objectContaining({
            action: "goal.review_goal_achieved",
            entityType: "goal",
            entityId: goalId,
            details: expect.objectContaining({
              verdict: "done",
              reason: "explicit evidence in linked issues and artifacts",
              source: "owner_review",
            }),
          }),
        ],
      ]),
    );
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("logs attention exhaustion exactly at the streak cap", async () => {
    const goalId = reviewGoals[0].id;
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve([{
            id: "77777777-7777-4777-8777-777777777777",
            identifier: "PAP-17",
            title: "Plan: Ship V1",
          }])),
        })),
      })),
    });
    mockGoalReviewService.listOwnedActiveGoals.mockResolvedValue([
      { id: goalId, lastVerdict: "stalled", verdictStreak: 6 },
    ]);
    mockGoalService.recordVerdict.mockResolvedValue({
      id: goalId,
      verdictStreak: 6,
    });

    const res = await request(createApp(agentActor()))
      .post("/api/agents/me/goal-review/verdicts")
      .send({ verdicts: [{ goalId, verdict: "stalled", reason: "stalled waiting on next unblock step" }] });

    expect(res.status).toBe(200);
    expect(res.body.planningIssues).toEqual([
      expect.objectContaining({ goalId, issueId: "77777777-7777-4777-8777-777777777777", identifier: "PAP-17", reused: true }),
    ]);
    expect(mockIssueService.create).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        action: "goal.review_attention_exhausted",
        entityId: goalId,
        details: expect.objectContaining({ verdictStreak: 6, maxVerdictStreak: 6 }),
      }),
    );
    // Exhausted goals no longer count toward attention.
    expect(mockGoalReviewService.stampGoalReviewState).toHaveBeenCalledWith(
      mockAgent,
      expect.objectContaining({ attentionGoalCount: 0 }),
    );
  });

  it("includes goal titles in inbox-lite items", async () => {
    const goalId = "44444444-4444-4444-8444-444444444444";
    mockIssueService.list.mockResolvedValue([
      {
        id: "66666666-6666-4666-8666-666666666666",
        identifier: "PAP-1",
        title: "Do the thing",
        status: "todo",
        priority: "medium",
        projectId: null,
        goalId,
        parentId: null,
        updatedAt: new Date("2026-06-09T00:00:00Z"),
        activeRun: null,
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        identifier: "PAP-2",
        title: "Goal-less task",
        status: "todo",
        priority: "low",
        projectId: null,
        goalId: null,
        parentId: null,
        updatedAt: new Date("2026-06-09T00:00:00Z"),
        activeRun: null,
      },
    ]);
    mockIssueService.listDependencyReadiness.mockResolvedValue(new Map());
    mockIssueRecoveryActionService.listActiveForIssues.mockResolvedValue(new Map());
    const whereResult = Promise.resolve([{ id: goalId, title: "Ship V1" }]);
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(() => whereResult) })),
    });

    const res = await request(createApp(agentActor())).get("/api/agents/me/inbox-lite");

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(
      expect.objectContaining({ goalId, goalTitle: "Ship V1" }),
    );
    expect(res.body[1]).toEqual(
      expect.objectContaining({ goalId: null, goalTitle: null }),
    );
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});
