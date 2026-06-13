import { z } from "zod";
import {
  ISSUE_PRIORITIES,
  ROUTINE_CATCH_UP_POLICIES,
  ROUTINE_CONCURRENCY_POLICIES,
} from "../constants.js";
import { envConfigSchema } from "./secret.js";
import { routineVariableSchema } from "./routine.js";

const sourceCorpusSchema = z.object({
  documents: z.array(z.object({ key: z.string().trim().min(1), revisionId: z.string().uuid() }).strict()).default([]),
  workProducts: z.array(z.object({ id: z.string().uuid() }).strict()).default([]),
  attachments: z.array(z.object({ id: z.string().uuid() }).strict()).default([]),
}).strict();

const wakeContractSchema = z.object({
  onTrigger: z.string().trim().min(1),
  onOverlap: z.string().trim().min(1),
  onPausedProject: z.string().trim().min(1),
  onManualRun: z.string().trim().min(1),
}).strict();

const scheduleTriggerSchema = z.object({
  kind: z.literal("schedule"),
  cronExpression: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
}).strict();

const apiTriggerSchema = z.object({ kind: z.literal("api") }).strict();

const webhookTriggerSchema = z.object({
  kind: z.literal("webhook"),
  signingMode: z.enum(["none", "bearer", "hmac_sha256"]).optional().nullable(),
  replayWindowSec: z.number().int().min(30).max(86_400).optional().nullable(),
}).strict();

export const routineProposalEntrySchema = z.object({
  proposalKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1),
  assigneeAgentId: z.string().uuid(),
  projectId: z.string().uuid(),
  goalId: z.string().uuid().optional().nullable(),
  parentIssueId: z.string().uuid().optional().nullable(),
  priority: z.enum(ISSUE_PRIORITIES).default("medium"),
  schedule: z.discriminatedUnion("kind", [scheduleTriggerSchema, apiTriggerSchema, webhookTriggerSchema]),
  variables: z.array(routineVariableSchema).default([]),
  env: envConfigSchema.optional().nullable(),
  concurrencyPolicy: z.enum(ROUTINE_CONCURRENCY_POLICIES).default("coalesce_if_active"),
  catchUpPolicy: z.enum(ROUTINE_CATCH_UP_POLICIES).default("skip_missed"),
  expectedOutputs: z.array(z.string().trim().min(1)).default([]),
  wakeContract: wakeContractSchema,
  rationale: z.string().trim().min(1),
  warnings: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const routineProposalArtifactSchema = z.object({
  version: z.literal(1),
  companyId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  sourceCorpus: sourceCorpusSchema,
  defaults: z.object({
    concurrencyPolicy: z.enum(ROUTINE_CONCURRENCY_POLICIES),
    catchUpPolicy: z.enum(ROUTINE_CATCH_UP_POLICIES),
  }).strict(),
  proposals: z.array(routineProposalEntrySchema),
  rejections: z.array(z.object({ sourceClaim: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict()).default([]),
  openQuestions: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const applyRoutineProposalSchema = z.object({
  workProductId: z.string().uuid().optional().nullable(),
  attachmentId: z.string().uuid().optional().nullable(),
}).strict().superRefine((value, ctx) => {
  const count = Number(Boolean(value.workProductId)) + Number(Boolean(value.attachmentId));
  if (count !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Exactly one of workProductId or attachmentId is required", path: ["workProductId"] });
  }
});

export type RoutineProposalArtifact = z.infer<typeof routineProposalArtifactSchema>;
export type RoutineProposalEntry = z.infer<typeof routineProposalEntrySchema>;
export type ApplyRoutineProposal = z.infer<typeof applyRoutineProposalSchema>;
