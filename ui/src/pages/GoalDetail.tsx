import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { assetsApi } from "../api/assets";
import { budgetsApi } from "../api/budgets";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalProperties } from "../components/GoalProperties";
import { GoalTree } from "../components/GoalTree";
import { BudgetPolicyCard } from "../components/BudgetPolicyCard";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEditor } from "../components/InlineEditor";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { cn, formatDateTime, issueUrl, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import type { BudgetPolicySummary, GoalOperatorView, Issue, IssueDocument, IssueWorkProduct, Project } from "@paperclipai/shared";

function AcceptanceCriteriaSection({
  criteria,
  onChange,
}: {
  criteria: string[];
  onChange: (criteria: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addCriterion = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...criteria, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase text-muted-foreground">Acceptance Criteria</h3>
      {criteria.length === 0 ? (
        <p className="text-sm text-muted-foreground">No acceptance criteria.</p>
      ) : (
        <ul className="space-y-1">
          {criteria.map((criterion, index) => (
            <li
              key={`${index}-${criterion}`}
              className="flex items-start gap-2 text-sm group"
            >
              <span className="text-muted-foreground mt-0.5">•</span>
              <span className="min-w-0 flex-1">{criterion}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                title="Remove criterion"
                aria-label="Remove criterion"
                onClick={() => onChange(criteria.filter((_, i) => i !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 max-w-md">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addCriterion();
          }}
          placeholder="Add a criterion..."
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" onClick={addCriterion} disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

interface GoalPropertiesToggleButtonProps {
  panelVisible: boolean;
  onShowProperties: () => void;
}

export function GoalPropertiesToggleButton({
  panelVisible,
  onShowProperties,
}: GoalPropertiesToggleButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn(
        "hidden md:inline-flex shrink-0 transition-opacity duration-200",
        panelVisible ? "opacity-0 pointer-events-none w-0 overflow-hidden" : "opacity-100",
      )}
      onClick={onShowProperties}
      title="Show properties"
    >
      <SlidersHorizontal className="h-4 w-4" />
    </Button>
  );
}

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openNewGoal } = useDialogActions();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const {
    data: goal,
    isLoading,
    error
  } = useQuery({
    queryKey: queryKeys.goals.detail(goalId!),
    queryFn: () => goalsApi.get(goalId!),
    enabled: !!goalId
  });
  const resolvedCompanyId = goal?.companyId ?? selectedCompanyId;

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(resolvedCompanyId!),
    queryFn: () => goalsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: allProjects } = useQuery({
    queryKey: queryKeys.projects.list(resolvedCompanyId!),
    queryFn: () => projectsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: linkedIssues } = useQuery({
    queryKey: [...queryKeys.issues.list(resolvedCompanyId ?? "__none__"), "goal", goalId ?? "__none__"],
    queryFn: () => issuesApi.list(resolvedCompanyId!, { goalId: goalId!, includeBlockedBy: true }),
    enabled: !!resolvedCompanyId && !!goalId,
  });

  const linkedIssueList = linkedIssues ?? [];
  const governingIssue = linkedIssueList.find((issue) => issue.planDocument || (issue.documentSummaries?.length ?? 0) > 0) ?? null;
  const primaryEvidenceIssue = linkedIssueList.find((issue) => (issue.workProducts?.length ?? 0) > 0) ?? null;

  const { data: governingDocuments } = useQuery({
    queryKey: queryKeys.issues.documents(governingIssue?.id ?? "__none__"),
    queryFn: () => issuesApi.listDocuments(governingIssue!.id, { includeSystem: true }),
    enabled: !!governingIssue?.id,
  });

  const { data: evidenceWorkProducts } = useQuery({
    queryKey: queryKeys.issues.workProducts(primaryEvidenceIssue?.id ?? "__none__"),
    queryFn: () => issuesApi.listWorkProducts(primaryEvidenceIssue!.id),
    enabled: !!primaryEvidenceIssue?.id,
  });

  useEffect(() => {
    if (!goal?.companyId || goal.companyId === selectedCompanyId) return;
    setSelectedCompanyId(goal.companyId, { source: "route_sync" });
  }, [goal?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const updateGoal = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      goalsApi.update(goalId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId!)
      });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(resolvedCompanyId)
        });
      }
    }
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(
        resolvedCompanyId,
        file,
        `goals/${goalId ?? "draft"}`
      );
    }
  });

  const { data: budgetOverview } = useQuery({
    queryKey: queryKeys.budgets.overview(resolvedCompanyId ?? "__none__"),
    queryFn: () => budgetsApi.overview(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });

  const goalBudgetSummary: BudgetPolicySummary | null = goal
    ? budgetOverview?.policies.find(
        (policy) => policy.scopeType === "goal" && policy.scopeId === goal.id,
      ) ?? {
        policyId: "",
        companyId: resolvedCompanyId ?? "",
        scopeType: "goal",
        scopeId: goal.id,
        scopeName: goal.title,
        metric: "billed_cents",
        windowKind: "lifetime",
        amount: 0,
        observedAmount: 0,
        remainingAmount: 0,
        utilizationPercent: 0,
        warnPercent: 80,
        hardStopEnabled: true,
        notifyEnabled: true,
        isActive: false,
        status: "ok",
        paused: Boolean(goal.pausedAt),
        pauseReason: goal.pauseReason ?? null,
        windowStart: new Date(),
        windowEnd: new Date(),
      }
    : null;

  const budgetMutation = useMutation({
    mutationFn: (amount: number) =>
      budgetsApi.upsertPolicy(resolvedCompanyId!, {
        scopeType: "goal",
        scopeId: goalId!,
        amount,
        windowKind: "lifetime",
      }),
    onSuccess: () => {
      if (!resolvedCompanyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.detail(goalId!) });
    },
  });

  const childGoals = (allGoals ?? []).filter((g) => g.parentId === goalId);
  const linkedProjects = (allProjects ?? []).filter((p) => {
    if (!goalId) return false;
    if (p.goalIds.includes(goalId)) return true;
    if (p.goals.some((goalRef) => goalRef.id === goalId)) return true;
    return p.goalId === goalId;
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Goals", href: "/goals" },
      { label: goal?.title ?? goalId ?? "Goal" }
    ]);
  }, [setBreadcrumbs, goal, goalId]);

  useEffect(() => {
    if (goal) {
      openPanel(
        <GoalProperties
          goal={goal}
          onUpdate={(data) => updateGoal.mutate(data)}
        />
      );
    }
    return () => closePanel();
  }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!goal) return null;

  const acceptedCriteria = goal.acceptanceCriteria ?? [];
  const openLinkedIssues = linkedIssueList.filter((issue) => !["done", "cancelled"].includes(issue.status));
  const evidenceProducts = (evidenceWorkProducts ?? []).filter((product) =>
    product.type === "artifact" || product.type === "document" || Boolean(product.url),
  );
  const docList = governingDocuments ?? [];
  const completedCriteriaCount = acceptedCriteria.filter((criterion) => {
    const normalizedCriterion = criterion.toLowerCase();
    return linkedIssueList.some((issue) => {
      const haystacks = [issue.title, issue.description ?? "", ...(issue.workProducts ?? []).map((product) => `${product.title} ${product.summary ?? ""}`)];
      return haystacks.some((entry) => entry.toLowerCase().includes(normalizedCriterion));
    });
  }).length;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">
            {goal.level}
          </span>
          <StatusBadge status={goal.status} />
          <div className="ml-auto">
            <GoalPropertiesToggleButton
              panelVisible={panelVisible}
              onShowProperties={() => setPanelVisible(true)}
            />
          </div>
        </div>

        <InlineEditor
          value={goal.title}
          onSave={(title) => updateGoal.mutate({ title })}
          as="h2"
          className="text-xl font-bold"
        />

        <InlineEditor
          value={goal.description ?? ""}
          onSave={(description) => updateGoal.mutate({ description })}
          as="p"
          className="text-sm text-muted-foreground"
          placeholder="Add a description..."
          multiline
          imageUploadHandler={async (file) => {
            const asset = await uploadImage.mutateAsync(file);
            return asset.contentPath;
          }}
        />
      </div>

      <AcceptanceCriteriaSection
        criteria={goal.acceptanceCriteria ?? []}
        onChange={(acceptanceCriteria) => updateGoal.mutate({ acceptanceCriteria })}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-4 space-y-1">
          <p className="text-xs uppercase text-muted-foreground">Goal Health</p>
          <p className="text-2xl font-semibold">{goal.lastVerdict ?? (goal.needsPlanning ? "needs planning" : "unreviewed")}</p>
          <p className="text-sm text-muted-foreground">
            {goal.lastVerdictReason ?? (goal.executionPath.hasExecutionPath
              ? `${openLinkedIssues.length} active linked issue${openLinkedIssues.length === 1 ? "" : "s"}`
              : "No active execution path yet")}
          </p>
          {goal.lastVerdictAt ? (
            <p className="text-xs text-muted-foreground">Updated {formatDateTime(goal.lastVerdictAt)}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-4 space-y-1">
          <p className="text-xs uppercase text-muted-foreground">Governing Artifacts</p>
          <p className="text-2xl font-semibold">{docList.length}</p>
          <p className="text-sm text-muted-foreground">
            {governingIssue
              ? `From ${governingIssue.identifier ?? governingIssue.id}`
              : "No linked plan or governing document yet"}
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-1">
          <p className="text-xs uppercase text-muted-foreground">Acceptance Evidence</p>
          <p className="text-2xl font-semibold">{acceptedCriteria.length === 0 ? "—" : `${completedCriteriaCount}/${acceptedCriteria.length}`}</p>
          <p className="text-sm text-muted-foreground">
            {evidenceProducts.length > 0
              ? `${evidenceProducts.length} deliverable work product${evidenceProducts.length === 1 ? "" : "s"}`
              : "No evidence-linked deliverables yet"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Linked Issues</h3>
            <span className="text-xs text-muted-foreground">{linkedIssueList.length}</span>
          </div>
          {linkedIssueList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues linked directly to this goal.</p>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              {linkedIssueList.map((issue, index) => (
                <div key={issue.id}>
                  <EntityRow
                    title={issue.title}
                    subtitle={issue.description ?? undefined}
                    to={issueUrl(issue)}
                    trailing={<StatusBadge status={issue.status} />}
                  />
                  {index < linkedIssueList.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Governing Artifacts</h3>
              {governingIssue ? (
                <a href={issueUrl(governingIssue)} className="text-xs text-muted-foreground hover:underline">
                  {governingIssue.identifier ?? governingIssue.id}
                </a>
              ) : null}
            </div>
            {docList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked plan, spec, or acceptance documents yet.</p>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                {docList.map((document: IssueDocument, index: number) => (
                  <div key={document.id}>
                    <EntityRow
                      title={document.title ?? document.key}
                      subtitle={`Updated ${formatDateTime(document.updatedAt)} · rev ${document.latestRevisionNumber}`}
                      to={`${issueUrl({ id: document.issueId, identifier: governingIssue?.identifier ?? document.issueId })}#document-${encodeURIComponent(document.key)}`}
                    />
                    {index < docList.length - 1 ? <Separator /> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Acceptance Evidence</h3>
              {primaryEvidenceIssue ? (
                <a href={issueUrl(primaryEvidenceIssue)} className="text-xs text-muted-foreground hover:underline">
                  {primaryEvidenceIssue.identifier ?? primaryEvidenceIssue.id}
                </a>
              ) : null}
            </div>
            {evidenceProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deliverables or evidence work products are linked yet.</p>
            ) : (
              <div className="border border-border rounded-md overflow-hidden">
                {evidenceProducts.map((product: IssueWorkProduct, index: number) => (
                  <div key={product.id}>
                    <EntityRow
                      title={product.title}
                      subtitle={product.summary ?? `${product.type} · ${product.status}`}
                      to={product.url ?? `${issueUrl(primaryEvidenceIssue ?? { id: product.issueId })}#work-product-${product.id}`}
                      trailing={<StatusBadge status={product.status} />}
                    />
                    {index < evidenceProducts.length - 1 ? <Separator /> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Tabs defaultValue="children">
        <TabsList>
          <TabsTrigger value="children">
            Sub-Goals ({childGoals.length})
          </TabsTrigger>
          <TabsTrigger value="projects">
            Projects ({linkedProjects.length})
          </TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="children" className="mt-4 space-y-3">
          <div className="flex items-center justify-start">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openNewGoal({ parentId: goalId })}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Sub Goal
            </Button>
          </div>
          {childGoals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sub-goals.</p>
          ) : (
            <GoalTree goals={childGoals} goalLink={(g) => `/goals/${g.id}`} />
          )}
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          {linkedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked projects.</p>
          ) : (
            <div className="border border-border">
              {linkedProjects.map((project) => (
                <EntityRow
                  key={project.id}
                  title={project.name}
                  subtitle={project.description ?? undefined}
                  to={projectUrl(project)}
                  trailing={<StatusBadge status={project.status} />}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="budget" className="mt-4">
          {goalBudgetSummary ? (
            <div className="max-w-3xl">
              <BudgetPolicyCard
                summary={goalBudgetSummary}
                variant="plain"
                isSaving={budgetMutation.isPending}
                onSave={(amount) => budgetMutation.mutate(amount)}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No budget data.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
