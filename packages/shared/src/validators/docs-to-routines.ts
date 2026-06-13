import { z } from "zod";
import {
  issueDocumentKeySchema,
  issueThreadInteractionContinuationPolicySchema,
} from "./issue.js";

export const docsToRoutinesProposalCorpusInputSchema = z.object({
  operatorPrompt: z.string().trim().max(20_000).optional().nullable(),
  references: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("issue_document"),
      issueId: z.string().uuid().nullable().optional(),
      documentId: z.string().uuid().nullable().optional(),
      key: issueDocumentKeySchema,
      title: z.string().trim().min(1).max(240).optional().nullable(),
      revisionId: z.string().uuid().optional().nullable(),
      revisionNumber: z.number().int().positive().optional().nullable(),
    }).strict(),
    z.object({
      kind: z.literal("issue_work_product"),
      issueId: z.string().uuid().nullable().optional(),
      workProductId: z.string().uuid(),
      title: z.string().trim().min(1).max(240).optional().nullable(),
      url: z.string().url().optional().nullable(),
    }).strict(),
    z.object({
      kind: z.literal("attachment"),
      attachmentId: z.string().uuid(),
      title: z.string().trim().min(1).max(240).optional().nullable(),
      contentType: z.string().trim().min(1).max(240).optional().nullable(),
      byteSize: z.number().int().nonnegative().optional().nullable(),
    }).strict(),
  ])).optional().default([]),
  defaults: z.object({
    concurrencyPolicy: z.enum(["coalesce_if_active", "always_enqueue", "skip_if_active"]).optional().default("coalesce_if_active"),
    catchUpPolicy: z.enum(["skip_missed", "enqueue_missed_with_cap"]).optional().default("skip_missed"),
    timezone: z.string().trim().min(1).max(120).optional().default("UTC"),
  }).optional().default({}),
}).strict();

export type DocsToRoutinesProposalCorpusInput = z.infer<typeof docsToRoutinesProposalCorpusInputSchema>;

export const generateDocsToRoutinesProposalSchema = z.object({
  corpus: docsToRoutinesProposalCorpusInputSchema.optional().default({}),
}).strict();

export type GenerateDocsToRoutinesProposal = z.infer<typeof generateDocsToRoutinesProposalSchema>;

export const requestDocsToRoutinesProposalReviewSchema = z.object({
  proposalDocumentKey: issueDocumentKeySchema,
  proposalLabel: z.string().trim().min(1).max(240).optional().nullable(),
  proposalRevisionId: z.string().uuid().optional().nullable(),
  proposalRevisionNumber: z.number().int().positive().optional().nullable(),
  proposalWorkProductId: z.string().uuid().optional().nullable(),
  prompt: z.string().trim().min(1).max(1000),
  detailsMarkdown: z.string().max(20_000).optional().nullable(),
  acceptLabel: z.string().trim().min(1).max(80).optional().nullable(),
  rejectLabel: z.string().trim().min(1).max(80).optional().nullable(),
  rejectRequiresReason: z.boolean().optional(),
  rejectReasonLabel: z.string().trim().min(1).max(160).optional().nullable(),
  allowDeclineReason: z.boolean().optional(),
  declineReasonPlaceholder: z.string().trim().min(1).max(240).optional().nullable(),
  supersedeOnUserComment: z.boolean().optional(),
  idempotencyKey: z.string().trim().max(255).optional().nullable(),
  continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee_on_accept"),
}).strict();

export type RequestDocsToRoutinesProposalReview = z.infer<typeof requestDocsToRoutinesProposalReviewSchema>;
