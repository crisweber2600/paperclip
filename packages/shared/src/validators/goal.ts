import { z } from "zod";
import { GOAL_LEVELS, GOAL_STATUSES, GOAL_VERDICTS, PAUSE_REASONS } from "../constants.js";

export const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  level: z.enum(GOAL_LEVELS).optional().default("task"),
  status: z.enum(GOAL_STATUSES).optional().default("planned"),
  parentId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(25).optional(),
});

export type CreateGoal = z.infer<typeof createGoalSchema>;

// Verdict, pause, and streak columns are server-managed and deliberately not
// part of the create/update schemas.
export const updateGoalSchema = createGoalSchema.partial();

export type UpdateGoal = z.infer<typeof updateGoalSchema>;

export const recordGoalVerdictsSchema = z.object({
  verdicts: z
    .array(
      z.object({
        goalId: z.string().uuid(),
        verdict: z.enum(GOAL_VERDICTS),
        reason: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(25),
});

export type RecordGoalVerdicts = z.infer<typeof recordGoalVerdictsSchema>;

export const goalExecutionPathSchema = z.object({
  openIssueCount: z.number().int().min(0),
  openProjectCount: z.number().int().min(0),
  hasExecutionPath: z.boolean(),
});

export const goalOperatorViewSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  level: z.enum(GOAL_LEVELS),
  status: z.enum(GOAL_STATUSES),
  parentId: z.string().uuid().nullable(),
  ownerAgentId: z.string().uuid().nullable(),
  acceptanceCriteria: z.array(z.string()),
  lastVerdict: z.enum(GOAL_VERDICTS).nullable(),
  lastVerdictReason: z.string().nullable(),
  lastVerdictAt: z.string().datetime().nullable(),
  lastVerdictByAgentId: z.string().uuid().nullable(),
  verdictStreak: z.number().int().min(0),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  pausedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  executionPath: goalExecutionPathSchema,
  needsPlanning: z.boolean(),
});

export const goalAncestorSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  level: z.enum(GOAL_LEVELS),
  status: z.enum(GOAL_STATUSES),
});

export const goalReviewItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  level: z.enum(GOAL_LEVELS),
  status: z.enum(GOAL_STATUSES),
  parentId: z.string().uuid().nullable(),
  ownerAgentId: z.string().uuid().nullable(),
  acceptanceCriteria: z.array(z.string()),
  lastVerdict: z.enum(GOAL_VERDICTS).nullable(),
  lastVerdictReason: z.string().nullable(),
  lastVerdictAt: z.string().datetime().nullable(),
  verdictStreak: z.number().int().min(0),
  verdictStale: z.boolean(),
  pausedAt: z.string().datetime().nullable(),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  ancestors: z.array(goalAncestorSummarySchema),
  executionPath: goalExecutionPathSchema,
  needsPlanning: z.boolean(),
});

export const goalReviewResponseSchema = z.object({
  agentId: z.string().uuid(),
  companyId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  intervalHours: z.number().positive(),
  lastReviewedAt: z.string().datetime().nullable(),
  goals: z.array(goalReviewItemSchema),
  routineHint: z.string().min(1),
});

export const goalReviewPlanningIssueSchema = z.object({
  goalId: z.string().uuid(),
  issueId: z.string().uuid(),
  identifier: z.string().nullable(),
  title: z.string().min(1),
  reused: z.boolean(),
});

export const goalReviewVerdictResultSchema = z.object({
  goalId: z.string().uuid(),
  verdict: z.enum(GOAL_VERDICTS),
  verdictStreak: z.number().int().min(0),
  recordedAt: z.string().datetime(),
});

export const recordGoalVerdictsResponseSchema = z.object({
  agentId: z.string().uuid(),
  recordedCount: z.number().int().min(0),
  attentionGoalCount: z.number().int().min(0),
  planningIssues: z.array(goalReviewPlanningIssueSchema),
  results: z.array(goalReviewVerdictResultSchema),
});

export const goalReviewWakeGoalSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
});

export const goalReviewWakeAttentionGoalSummarySchema = goalReviewWakeGoalSummarySchema.extend({
  lastVerdict: z.enum(GOAL_VERDICTS).nullable(),
  verdictStreak: z.number().int().min(0),
});

export const goalReviewWakeContextSchema = z.object({
  due: z.literal(true),
  ownedActiveGoalCount: z.number().int().min(0),
  goalsWithoutExecutionPathCount: z.number().int().min(0),
  goalsWithoutExecutionPath: z.array(goalReviewWakeGoalSummarySchema),
  attentionGoalCount: z.number().int().min(0),
  attentionGoals: z.array(goalReviewWakeAttentionGoalSummarySchema),
});

export const goalReviewRuntimeStateSchema = z.object({
  lastEvaluatedAt: z.string().datetime().optional(),
  lastSurfacedAt: z.string().datetime().optional(),
  lastCheckedAt: z.string().datetime().optional(),
  attentionGoalCount: z.number().int().min(0).optional(),
});

export type GoalExecutionPath = z.infer<typeof goalExecutionPathSchema>;
export type GoalOperatorViewPayload = z.infer<typeof goalOperatorViewSchema>;
export type GoalAncestorSummary = z.infer<typeof goalAncestorSummarySchema>;
export type GoalReviewItem = z.infer<typeof goalReviewItemSchema>;
export type GoalReviewResponse = z.infer<typeof goalReviewResponseSchema>;
export type GoalReviewPlanningIssue = z.infer<typeof goalReviewPlanningIssueSchema>;
export type GoalReviewVerdictResult = z.infer<typeof goalReviewVerdictResultSchema>;
export type RecordGoalVerdictsResponse = z.infer<typeof recordGoalVerdictsResponseSchema>;
export type GoalReviewWakeGoalSummary = z.infer<typeof goalReviewWakeGoalSummarySchema>;
export type GoalReviewWakeAttentionGoalSummary = z.infer<typeof goalReviewWakeAttentionGoalSummarySchema>;
export type GoalReviewWakeContext = z.infer<typeof goalReviewWakeContextSchema>;
export type GoalReviewRuntimeState = z.infer<typeof goalReviewRuntimeStateSchema>;
