import type { GoalLevel, GoalStatus, IssueStatus, ProjectStatus } from "../constants.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalContextRef {
  id: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
}

export interface GoalContext extends GoalContextRef {
  ancestry: GoalContextRef[];
  childGoalCount: number;
}

export type GoalReviewRecommendedAction =
  | "continue_existing_work"
  | "needs_planning_issue"
  | "needs_unblock"
  | "needs_delegation"
  | "no_action";

export interface GoalReviewLinkedProject {
  id: string;
  name: string;
  status: ProjectStatus;
  goalId: string | null;
  leadAgentId: string | null;
  archivedAt: Date | null;
}

export interface GoalReviewIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  assigneeAgentId: string | null;
  projectId: string | null;
  updatedAt: Date;
}

export interface GoalReviewItem extends GoalContext {
  linkedProjects: GoalReviewLinkedProject[];
  openIssuesByStatus: Record<IssueStatus, number>;
  openIssues: GoalReviewIssueSummary[];
  hasNonBlockedOpenIssue: boolean;
  hasIssueAssignedToCurrentAgent: boolean;
  recommendedAction: GoalReviewRecommendedAction;
}
