import {
  instrumentFunction,
  instrumentServiceFactory,
} from "../observability/method-tracing.js";
import { companyService as rawCompanyService } from "./companies.js";
import { companySearchService as rawCompanySearchService } from "./company-search.js";
import { feedbackService as rawFeedbackService } from "./feedback.js";
import { companySkillService as rawCompanySkillService } from "./company-skills.js";
import { agentService as rawAgentService } from "./agents.js";
import { agentInstructionsService as rawAgentInstructionsService } from "./agent-instructions.js";
import { assetService as rawAssetService } from "./assets.js";
import { documentService as rawDocumentService } from "./documents.js";
import { documentAnnotationService as rawDocumentAnnotationService } from "./document-annotations.js";
import { projectService as rawProjectService } from "./projects.js";
import { issueService as rawIssueService } from "./issues.js";
import { issueThreadInteractionService as rawIssueThreadInteractionService } from "./issue-thread-interactions.js";
import { issueTreeControlService as rawIssueTreeControlService } from "./issue-tree-control.js";
import { issueApprovalService as rawIssueApprovalService } from "./issue-approvals.js";
import { issueReferenceService as rawIssueReferenceService } from "./issue-references.js";
import { issueRecoveryActionService as rawIssueRecoveryActionService } from "./issue-recovery-actions.js";
import { goalService as rawGoalService } from "./goals.js";
import { goalExecutionService as rawGoalExecutionService } from "./goal-execution.js";
import { activityService as rawActivityService } from "./activity.js";
import { approvalService as rawApprovalService } from "./approvals.js";
import { budgetService as rawBudgetService } from "./budgets.js";
import { secretService as rawSecretService } from "./secrets.js";
import { routineService as rawRoutineService } from "./routines.js";
import { costService as rawCostService } from "./costs.js";
import { financeService as rawFinanceService } from "./finance.js";
import { heartbeatService as rawHeartbeatService } from "./heartbeat.js";
import { productivityReviewService as rawProductivityReviewService } from "./productivity-review.js";
import { dashboardService as rawDashboardService } from "./dashboard.js";
import { sidebarBadgeService as rawSidebarBadgeService } from "./sidebar-badges.js";
import { sidebarPreferenceService as rawSidebarPreferenceService } from "./sidebar-preferences.js";
import { resourceMembershipService as rawResourceMembershipService } from "./resource-memberships.js";
import { inboxDismissalService as rawInboxDismissalService } from "./inbox-dismissals.js";
import { accessService as rawAccessService } from "./access.js";
import { authorizationService as rawAuthorizationService } from "./authorization.js";
import { boardAuthService as rawBoardAuthService } from "./board-auth.js";
import { instanceSettingsService as rawInstanceSettingsService } from "./instance-settings.js";
import {
  cloudUpstreamService as rawCloudUpstreamService,
  reconcileCloudUpstreamRunsOnStartup as rawReconcileCloudUpstreamRunsOnStartup,
} from "./cloud-upstreams.js";
import { companyPortabilityService as rawCompanyPortabilityService } from "./company-portability.js";
import { environmentService as rawEnvironmentService } from "./environments.js";
import { executionWorkspaceService as rawExecutionWorkspaceService } from "./execution-workspaces.js";
import { workspaceOperationService as rawWorkspaceOperationService } from "./workspace-operations.js";
import { workProductService as rawWorkProductService } from "./work-products.js";
import { logActivity as rawLogActivity } from "./activity-log.js";
import { notifyHireApproved as rawNotifyHireApproved } from "./hire-hook.js";
import {
  publishLiveEvent as rawPublishLiveEvent,
  subscribeCompanyLiveEvents as rawSubscribeCompanyLiveEvents,
} from "./live-events.js";
import {
  reconcilePersistedRuntimeServicesOnStartup as rawReconcilePersistedRuntimeServicesOnStartup,
  restartDesiredRuntimeServicesOnStartup as rawRestartDesiredRuntimeServicesOnStartup,
} from "./workspace-runtime.js";
import {
  createStorageServiceFromConfig as rawCreateStorageServiceFromConfig,
  getStorageService as rawGetStorageService,
} from "../storage/index.js";

export const companyService: typeof rawCompanyService = instrumentServiceFactory("companyService", rawCompanyService);
export const companySearchService: typeof rawCompanySearchService = instrumentServiceFactory(
  "companySearchService",
  rawCompanySearchService,
);
export const feedbackService: typeof rawFeedbackService = instrumentServiceFactory("feedbackService", rawFeedbackService);
export const companySkillService: typeof rawCompanySkillService = instrumentServiceFactory(
  "companySkillService",
  rawCompanySkillService,
);
export const agentService: typeof rawAgentService = instrumentServiceFactory("agentService", rawAgentService);
export const agentInstructionsService: typeof rawAgentInstructionsService = instrumentServiceFactory(
  "agentInstructionsService",
  rawAgentInstructionsService,
);
export const assetService: typeof rawAssetService = instrumentServiceFactory("assetService", rawAssetService);
export const documentService: typeof rawDocumentService = instrumentServiceFactory("documentService", rawDocumentService);
export const documentAnnotationService: typeof rawDocumentAnnotationService = instrumentServiceFactory(
  "documentAnnotationService",
  rawDocumentAnnotationService,
);
export const projectService: typeof rawProjectService = instrumentServiceFactory("projectService", rawProjectService);
export const issueService: typeof rawIssueService = instrumentServiceFactory("issueService", rawIssueService);
export const issueThreadInteractionService: typeof rawIssueThreadInteractionService = instrumentServiceFactory(
  "issueThreadInteractionService",
  rawIssueThreadInteractionService,
);
export const issueTreeControlService: typeof rawIssueTreeControlService = instrumentServiceFactory(
  "issueTreeControlService",
  rawIssueTreeControlService,
);
export const issueApprovalService: typeof rawIssueApprovalService = instrumentServiceFactory(
  "issueApprovalService",
  rawIssueApprovalService,
);
export const issueReferenceService: typeof rawIssueReferenceService = instrumentServiceFactory(
  "issueReferenceService",
  rawIssueReferenceService,
);
export const issueRecoveryActionService: typeof rawIssueRecoveryActionService = instrumentServiceFactory(
  "issueRecoveryActionService",
  rawIssueRecoveryActionService,
);
export const goalService: typeof rawGoalService = instrumentServiceFactory("goalService", rawGoalService);
export const goalExecutionService: typeof rawGoalExecutionService = instrumentServiceFactory(
  "goalExecutionService",
  rawGoalExecutionService,
);
export const activityService: typeof rawActivityService = instrumentServiceFactory("activityService", rawActivityService);
export const approvalService: typeof rawApprovalService = instrumentServiceFactory("approvalService", rawApprovalService);
export const budgetService: typeof rawBudgetService = instrumentServiceFactory("budgetService", rawBudgetService);
export const secretService: typeof rawSecretService = instrumentServiceFactory("secretService", rawSecretService);
export const routineService: typeof rawRoutineService = instrumentServiceFactory("routineService", rawRoutineService);
export const costService: typeof rawCostService = instrumentServiceFactory("costService", rawCostService);
export const financeService: typeof rawFinanceService = instrumentServiceFactory("financeService", rawFinanceService);
export const heartbeatService: typeof rawHeartbeatService = instrumentServiceFactory(
  "heartbeatService",
  rawHeartbeatService,
);
export const productivityReviewService: typeof rawProductivityReviewService = instrumentServiceFactory(
  "productivityReviewService",
  rawProductivityReviewService,
);
export const dashboardService: typeof rawDashboardService = instrumentServiceFactory(
  "dashboardService",
  rawDashboardService,
);
export const sidebarBadgeService: typeof rawSidebarBadgeService = instrumentServiceFactory(
  "sidebarBadgeService",
  rawSidebarBadgeService,
);
export const sidebarPreferenceService: typeof rawSidebarPreferenceService = instrumentServiceFactory(
  "sidebarPreferenceService",
  rawSidebarPreferenceService,
);
export const resourceMembershipService: typeof rawResourceMembershipService = instrumentServiceFactory(
  "resourceMembershipService",
  rawResourceMembershipService,
);
export const inboxDismissalService: typeof rawInboxDismissalService = instrumentServiceFactory(
  "inboxDismissalService",
  rawInboxDismissalService,
);
export const accessService: typeof rawAccessService = instrumentServiceFactory("accessService", rawAccessService);
export const authorizationService: typeof rawAuthorizationService = instrumentServiceFactory(
  "authorizationService",
  rawAuthorizationService,
);
export const boardAuthService: typeof rawBoardAuthService = instrumentServiceFactory("boardAuthService", rawBoardAuthService);
export const instanceSettingsService: typeof rawInstanceSettingsService = instrumentServiceFactory(
  "instanceSettingsService",
  rawInstanceSettingsService,
);
export const cloudUpstreamService: typeof rawCloudUpstreamService = instrumentServiceFactory(
  "cloudUpstreamService",
  rawCloudUpstreamService,
);
export const companyPortabilityService: typeof rawCompanyPortabilityService = instrumentServiceFactory(
  "companyPortabilityService",
  rawCompanyPortabilityService,
);
export const environmentService: typeof rawEnvironmentService = instrumentServiceFactory(
  "environmentService",
  rawEnvironmentService,
);
export const executionWorkspaceService: typeof rawExecutionWorkspaceService = instrumentServiceFactory(
  "executionWorkspaceService",
  rawExecutionWorkspaceService,
);
export const workspaceOperationService: typeof rawWorkspaceOperationService = instrumentServiceFactory(
  "workspaceOperationService",
  rawWorkspaceOperationService,
);
export const workProductService: typeof rawWorkProductService = instrumentServiceFactory(
  "workProductService",
  rawWorkProductService,
);
export const createStorageServiceFromConfig: typeof rawCreateStorageServiceFromConfig = instrumentServiceFactory(
  "storageService",
  rawCreateStorageServiceFromConfig,
);
export const getStorageService: typeof rawGetStorageService = instrumentServiceFactory("storageService", rawGetStorageService);

export const logActivity: typeof rawLogActivity = instrumentFunction("activityLog.logActivity", rawLogActivity);
export const notifyHireApproved: typeof rawNotifyHireApproved = instrumentFunction(
  "hireHook.notifyHireApproved",
  rawNotifyHireApproved,
);
export const publishLiveEvent: typeof rawPublishLiveEvent = instrumentFunction(
  "liveEvents.publishLiveEvent",
  rawPublishLiveEvent,
);
export const subscribeCompanyLiveEvents: typeof rawSubscribeCompanyLiveEvents = instrumentFunction(
  "liveEvents.subscribeCompanyLiveEvents",
  rawSubscribeCompanyLiveEvents,
);
export const reconcilePersistedRuntimeServicesOnStartup: typeof rawReconcilePersistedRuntimeServicesOnStartup = instrumentFunction(
  "workspaceRuntime.reconcilePersistedRuntimeServicesOnStartup",
  rawReconcilePersistedRuntimeServicesOnStartup,
);
export const restartDesiredRuntimeServicesOnStartup: typeof rawRestartDesiredRuntimeServicesOnStartup = instrumentFunction(
  "workspaceRuntime.restartDesiredRuntimeServicesOnStartup",
  rawRestartDesiredRuntimeServicesOnStartup,
);
export const reconcileCloudUpstreamRunsOnStartup: typeof rawReconcileCloudUpstreamRunsOnStartup = instrumentFunction(
  "cloudUpstreams.reconcileCloudUpstreamRunsOnStartup",
  rawReconcileCloudUpstreamRunsOnStartup,
);

export { deduplicateAgentName } from "./agents.js";
export { syncInstructionsBundleConfigFromFilePath } from "./agent-instructions.js";
export { extractLegacyPlanBody } from "./documents.js";
export {
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  buildContinuationSummaryMarkdown,
  getIssueContinuationSummaryDocument,
  refreshIssueContinuationSummary,
} from "./issue-continuation-summary.js";
export {
  clampIssueListLimit,
  ISSUE_LIST_DEFAULT_LIMIT,
  ISSUE_LIST_MAX_LIMIT,
  type IssueFilters,
} from "./issues.js";
export type { GoalReviewItem, GoalReviewRecommendedAction } from "./goal-execution.js";
export type { ActivityFilters } from "./activity.js";
export { PRODUCTIVITY_REVIEW_ORIGIN_KIND } from "./productivity-review.js";
export { classifyIssueGraphLiveness, type IssueLivenessFinding } from "./recovery/index.js";
export type { ResourceMembershipPolicyHook } from "./resource-memberships.js";
export {
  backfillPrincipalAccessCompatibility,
  ensureHumanRoleDefaultGrants,
  insertMissingPrincipalGrants,
  type PrincipalAccessCompatibilityBackfillStats,
} from "./principal-access-compatibility.js";
export type {
  AuthorizationAction,
  AuthorizationActor,
  AuthorizationDecision,
  AuthorizationResource,
} from "./authorization.js";
export type { LogActivityInput } from "./activity-log.js";
export type { NotifyHireApprovedInput } from "./hire-hook.js";
