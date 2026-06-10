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
}));

const mockIssueService = vi.hoisted(() => ({
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
  goalReviewService: () => mockGoalReviewService,
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
    mockGoalReviewService.getGoalReviewState.mockResolvedValue({
      lastCheckedAt: "2026-06-09T06:00:00.000Z",
    });
    mockGoalReviewService.stampGoalReviewState.mockResolvedValue(undefined);
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
