import { z } from "zod";
import { GOAL_LEVELS, GOAL_STATUSES, GOAL_VERDICTS } from "../constants.js";

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
