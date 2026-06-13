import { z } from "zod";

export const paperclipWakeIssueGoalAncestorSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
  level: z.string().nullable(),
  status: z.string().nullable(),
  description: z.string().nullable(),
});

export const paperclipWakeIssueGoalSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  level: z.string().nullable(),
  ownerAgentId: z.string().nullable(),
  description: z.string().nullable(),
  descriptionTruncated: z.boolean(),
  ancestors: z.array(paperclipWakeIssueGoalAncestorSchema),
});

export const paperclipWakeIssueSchema = z.object({
  id: z.string().nullable(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  workMode: z.string().nullable(),
  priority: z.string().nullable(),
  goalId: z.string().nullable(),
  goal: paperclipWakeIssueGoalSchema.nullable(),
});

export const paperclipWakeExecutionPrincipalSchema = z.object({
  type: z.enum(["agent", "user"]).nullable(),
  agentId: z.string().nullable(),
  userId: z.string().nullable(),
});

export const paperclipWakeExecutionStageSchema = z.object({
  wakeRole: z.enum(["reviewer", "approver", "executor"]).nullable(),
  stageId: z.string().nullable(),
  stageType: z.string().nullable(),
  currentParticipant: paperclipWakeExecutionPrincipalSchema.nullable(),
  returnAssignee: paperclipWakeExecutionPrincipalSchema.nullable(),
  reviewRequest: z.object({ instructions: z.string() }).nullable(),
  lastDecisionOutcome: z.string().nullable(),
  allowedActions: z.array(z.string()),
});

export const paperclipWakeCommentSchema = z.object({
  id: z.string().nullable(),
  issueId: z.string().nullable(),
  body: z.string(),
  bodyTruncated: z.boolean(),
  createdAt: z.string().nullable(),
  authorType: z.string().nullable(),
  authorId: z.string().nullable(),
});

export const paperclipWakeContinuationSummarySchema = z.object({
  key: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string(),
  bodyTruncated: z.boolean(),
  updatedAt: z.string().nullable(),
});

export const paperclipWakeLivenessContinuationSchema = z.object({
  attempt: z.number().int().nullable(),
  maxAttempts: z.number().int().nullable(),
  sourceRunId: z.string().nullable(),
  state: z.string().nullable(),
  reason: z.string().nullable(),
  instruction: z.string().nullable(),
});

export const paperclipWakeChildIssueSummarySchema = z.object({
  id: z.string().nullable(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  summary: z.string().nullable(),
});

export const paperclipWakeBlockerSummarySchema = z.object({
  id: z.string().nullable(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
});

export const paperclipWakeTreeHoldSummarySchema = z.object({
  holdId: z.string().nullable(),
  rootIssueId: z.string().nullable(),
  mode: z.string().nullable(),
  reason: z.string().nullable(),
});

export const paperclipWakeGoalReviewGoalRefSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
});

export const paperclipWakeGoalReviewAttentionGoalSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
  lastVerdict: z.string().nullable(),
  verdictStreak: z.number().int(),
});

export const paperclipWakeGoalReviewSchema = z.object({
  due: z.boolean(),
  ownedActiveGoalCount: z.number().int(),
  goalsWithoutExecutionPathCount: z.number().int(),
  goalsWithoutExecutionPath: z.array(paperclipWakeGoalReviewGoalRefSchema),
  attentionGoalCount: z.number().int(),
  attentionGoals: z.array(paperclipWakeGoalReviewAttentionGoalSchema),
});

export const paperclipWakePayloadSchema = z.object({
  reason: z.string().nullable(),
  issue: paperclipWakeIssueSchema.nullable(),
  checkedOutByHarness: z.boolean(),
  dependencyBlockedInteraction: z.boolean(),
  treeHoldInteraction: z.boolean(),
  activeTreeHold: paperclipWakeTreeHoldSummarySchema.nullable(),
  unresolvedBlockerIssueIds: z.array(z.string()),
  unresolvedBlockerSummaries: z.array(paperclipWakeBlockerSummarySchema),
  executionStage: paperclipWakeExecutionStageSchema.nullable(),
  goalReview: paperclipWakeGoalReviewSchema.nullable(),
  continuationSummary: paperclipWakeContinuationSummarySchema.nullable(),
  livenessContinuation: paperclipWakeLivenessContinuationSchema.nullable(),
  interactionKind: z.string().nullable(),
  interactionStatus: z.string().nullable(),
  childIssueSummaries: z.array(paperclipWakeChildIssueSummarySchema),
  childIssueSummaryTruncated: z.boolean(),
  commentIds: z.array(z.string()),
  latestCommentId: z.string().nullable(),
  comments: z.array(paperclipWakeCommentSchema),
  requestedCount: z.number().int(),
  includedCount: z.number().int(),
  missingCount: z.number().int(),
  truncated: z.boolean(),
  fallbackFetchNeeded: z.boolean(),
});

export type PaperclipWakeIssueGoalAncestor = z.infer<typeof paperclipWakeIssueGoalAncestorSchema>;
export type PaperclipWakeIssueGoal = z.infer<typeof paperclipWakeIssueGoalSchema>;
export type PaperclipWakeIssue = z.infer<typeof paperclipWakeIssueSchema>;
export type PaperclipWakeExecutionPrincipal = z.infer<typeof paperclipWakeExecutionPrincipalSchema>;
export type PaperclipWakeExecutionStage = z.infer<typeof paperclipWakeExecutionStageSchema>;
export type PaperclipWakeComment = z.infer<typeof paperclipWakeCommentSchema>;
export type PaperclipWakeContinuationSummary = z.infer<typeof paperclipWakeContinuationSummarySchema>;
export type PaperclipWakeLivenessContinuation = z.infer<typeof paperclipWakeLivenessContinuationSchema>;
export type PaperclipWakeChildIssueSummary = z.infer<typeof paperclipWakeChildIssueSummarySchema>;
export type PaperclipWakeBlockerSummary = z.infer<typeof paperclipWakeBlockerSummarySchema>;
export type PaperclipWakeTreeHoldSummary = z.infer<typeof paperclipWakeTreeHoldSummarySchema>;
export type PaperclipWakeGoalReviewGoalRef = z.infer<typeof paperclipWakeGoalReviewGoalRefSchema>;
export type PaperclipWakeGoalReviewAttentionGoal = z.infer<typeof paperclipWakeGoalReviewAttentionGoalSchema>;
export type PaperclipWakeGoalReview = z.infer<typeof paperclipWakeGoalReviewSchema>;
export type PaperclipWakePayload = z.infer<typeof paperclipWakePayloadSchema>;
