import type { GoalLevel, GoalStatus, GoalVerdict, PauseReason } from "../constants.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  acceptanceCriteria: string[];
  lastVerdict: GoalVerdict | null;
  lastVerdictReason: string | null;
  lastVerdictAt: Date | null;
  lastVerdictByAgentId: string | null;
  verdictStreak: number;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalOperatorView {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  acceptanceCriteria: string[];
  lastVerdict: GoalVerdict | null;
  lastVerdictReason: string | null;
  lastVerdictAt: Date | string | null;
  lastVerdictByAgentId: string | null;
  verdictStreak: number;
  pauseReason: PauseReason | null;
  pausedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  executionPath: GoalExecutionPath;
  needsPlanning: boolean;
}

export interface GoalExecutionPath {
  openIssueCount: number;
  openProjectCount: number;
  hasExecutionPath: boolean;
}

export interface GoalAncestorSummary {
  id: string;
  title: string;
  level: GoalLevel;
  status: GoalStatus;
}

export interface GoalReviewItem {
  id: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  acceptanceCriteria: string[];
  lastVerdict: GoalVerdict | null;
  lastVerdictReason: string | null;
  lastVerdictAt: Date | string | null;
  verdictStreak: number;
  verdictStale: boolean;
  pausedAt: Date | string | null;
  pauseReason: PauseReason | null;
  ancestors: GoalAncestorSummary[];
  executionPath: GoalExecutionPath;
  needsPlanning: boolean;
}

export interface GoalReviewResponse {
  agentId: string;
  companyId: string;
  generatedAt: Date | string;
  intervalHours: number;
  lastReviewedAt: Date | string | null;
  goals: GoalReviewItem[];
  routineHint: string;
}

export interface GoalReviewPlanningIssue {
  goalId: string;
  issueId: string;
  identifier: string | null;
  title: string;
  reused: boolean;
}

export interface GoalReviewVerdictResult {
  goalId: string;
  verdict: GoalVerdict;
  verdictStreak: number;
  recordedAt: Date | string;
}

export interface RecordGoalVerdictsResponse {
  agentId: string;
  recordedCount: number;
  attentionGoalCount: number;
  planningIssues: GoalReviewPlanningIssue[];
  results: GoalReviewVerdictResult[];
}

export interface GoalReviewWakeGoalSummary {
  id: string;
  title: string;
}

export interface GoalReviewWakeAttentionGoalSummary extends GoalReviewWakeGoalSummary {
  lastVerdict: GoalVerdict | null;
  verdictStreak: number;
}

export interface GoalReviewWakeContext {
  due: true;
  ownedActiveGoalCount: number;
  goalsWithoutExecutionPathCount: number;
  goalsWithoutExecutionPath: GoalReviewWakeGoalSummary[];
  attentionGoalCount: number;
  attentionGoals: GoalReviewWakeAttentionGoalSummary[];
}

export interface GoalReviewRuntimeState {
  lastEvaluatedAt?: string;
  lastSurfacedAt?: string;
  lastCheckedAt?: string;
  attentionGoalCount?: number;
}
