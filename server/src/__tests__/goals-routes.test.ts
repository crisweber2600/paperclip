import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { goalRoutes } from "../routes/goals.js";

const mockGoalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  listOperatorView: vi.fn(),
  getOperatorById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => null,
}));

vi.mock("../services/index.js", () => ({
  goalService: () => mockGoalService,
  logActivity: vi.fn(async () => undefined),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", goalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("goal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists operator goal state for board users", async () => {
    mockGoalService.listOperatorView.mockResolvedValue([
      {
        id: "goal-1",
        companyId: "company-1",
        title: "Ship V1",
        description: null,
        level: "company",
        status: "active",
        parentId: null,
        ownerAgentId: null,
        acceptanceCriteria: [],
        lastVerdict: null,
        lastVerdictReason: null,
        lastVerdictAt: null,
        lastVerdictByAgentId: null,
        verdictStreak: 0,
        pauseReason: null,
        pausedAt: null,
        createdAt: new Date("2026-06-13T00:00:00.000Z"),
        updatedAt: new Date("2026-06-13T00:00:00.000Z"),
        executionPath: { openIssueCount: 0, openProjectCount: 1, hasExecutionPath: true },
        needsPlanning: false,
      },
    ]);

    const res = await request(createApp()).get("/api/companies/company-1/goals");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "goal-1",
          executionPath: { openIssueCount: 0, openProjectCount: 1, hasExecutionPath: true },
          needsPlanning: false,
        }),
      ]),
    );
  });

  it("gets operator goal state for board users", async () => {
    mockGoalService.getOperatorById.mockResolvedValue({
      id: "goal-2",
      companyId: "company-1",
      title: "Plan GTM",
      description: null,
      level: "team",
      status: "active",
      parentId: null,
      ownerAgentId: "agent-1",
      acceptanceCriteria: [],
      lastVerdict: "stalled",
      lastVerdictReason: "No active issue",
      lastVerdictAt: new Date("2026-06-13T00:00:00.000Z"),
      lastVerdictByAgentId: "agent-1",
      verdictStreak: 2,
      pauseReason: null,
      pausedAt: null,
      createdAt: new Date("2026-06-13T00:00:00.000Z"),
      updatedAt: new Date("2026-06-13T00:00:00.000Z"),
      executionPath: { openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false },
      needsPlanning: true,
    });

    const res = await request(createApp()).get("/api/goals/goal-2");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "goal-2",
        executionPath: { openIssueCount: 0, openProjectCount: 0, hasExecutionPath: false },
        needsPlanning: true,
      }),
    );
  });
});
