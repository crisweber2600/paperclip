import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, issueAttachments, issueWorkProducts, routineTriggers, routines } from "@paperclipai/db";
import { routineProposalArtifactSchema, type RoutineProposalEntry } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { issueService } from "./issues.js";
import { routineService } from "./routines.js";
import type { StorageService } from "../storage/types.js";

type Actor = { agentId?: string; userId?: string; runId?: string | null };

type ProposalResult =
  | { proposalKey: string; title: string; outcome: "created" | "updated" | "unchanged"; routineId: string }
  | { proposalKey: string; title: string; outcome: "rejected"; reason: string };

export type RoutineProposalApplyResult = {
  artifactSource: { workProductId?: string; attachmentId?: string };
  summary: { created: number; updated: number; unchanged: number; rejected: number };
  results: ProposalResult[];
};

function normalizeTextBody(buffer: Buffer) {
  return buffer.toString("utf8");
}

function triggerEqualsProposal(trigger: typeof routineTriggers.$inferSelect, proposal: RoutineProposalEntry["schedule"]) {
  if (trigger.kind !== proposal.kind) return false;
  if (proposal.kind === "schedule") {
    return trigger.cronExpression === proposal.cronExpression && trigger.timezone === proposal.timezone;
  }
  if (proposal.kind === "webhook") {
    return trigger.signingMode === (proposal.signingMode ?? "bearer")
      && trigger.replayWindowSec === (proposal.replayWindowSec ?? 300);
  }
  return true;
}

function toCreateTriggerInput(proposal: RoutineProposalEntry["schedule"]) {
  if (proposal.kind === "schedule") {
    return {
      kind: "schedule" as const,
      enabled: true,
      cronExpression: proposal.cronExpression,
      timezone: proposal.timezone,
    };
  }
  if (proposal.kind === "webhook") {
    return {
      kind: "webhook" as const,
      enabled: true,
      signingMode: proposal.signingMode ?? "bearer",
      replayWindowSec: proposal.replayWindowSec ?? 300,
    };
  }
  return {
    kind: "api" as const,
    enabled: true,
  };
}

function toUpdateTriggerInput(proposal: RoutineProposalEntry["schedule"]) {
  if (proposal.kind === "schedule") {
    return {
      cronExpression: proposal.cronExpression,
      timezone: proposal.timezone,
    };
  }
  if (proposal.kind === "webhook") {
    return {
      signingMode: proposal.signingMode ?? "bearer",
      replayWindowSec: proposal.replayWindowSec ?? 300,
    };
  }
  return {};
}

function proposalComment(result: RoutineProposalApplyResult) {
  const lines = [
    "Applied routine proposal artifact.",
    "",
    `- Created: ${result.summary.created}`,
    `- Updated: ${result.summary.updated}`,
    `- Unchanged: ${result.summary.unchanged}`,
    `- Rejected: ${result.summary.rejected}`,
    "",
  ];
  for (const entry of result.results) {
    if (entry.outcome === "rejected") {
      lines.push(`- Rejected \`${entry.proposalKey}\` (${entry.title}): ${entry.reason}`);
    } else {
      lines.push(`- ${entry.outcome[0]!.toUpperCase()}${entry.outcome.slice(1)} \`${entry.proposalKey}\` (${entry.title}) → routine ${entry.routineId}`);
    }
  }
  return lines.join("\n");
}

export function routineProposalReconciliationService(db: Db, storage: StorageService) {
  const issuesSvc = issueService(db);
  const routinesSvc = routineService(db);

  async function readArtifactBody(issueId: string, input: { workProductId?: string | null; attachmentId?: string | null }) {
    let attachmentId = input.attachmentId ?? null;
    if (input.workProductId) {
      const row = await db.select().from(issueWorkProducts)
        .where(and(eq(issueWorkProducts.issueId, issueId), eq(issueWorkProducts.id, input.workProductId)))
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Work product not found");
      const metadata = row.metadata as Record<string, unknown> | null;
      attachmentId = typeof metadata?.attachmentId === "string" ? metadata.attachmentId : null;
      if (!attachmentId) throw unprocessable("Work product is not attachment-backed");
    }

    const attachment = await db.select({
      id: issueAttachments.id,
      companyId: issueAttachments.companyId,
      objectKey: assets.objectKey,
    })
      .from(issueAttachments)
      .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
      .where(and(eq(issueAttachments.issueId, issueId), eq(issueAttachments.id, attachmentId!)))
      .then((rows) => rows[0] ?? null);
    if (!attachment) throw notFound("Attachment not found");
    const object = await storage.getObject(attachment.companyId, attachment.objectKey);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      object.stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      object.stream.on("end", () => resolve());
      object.stream.on("error", reject);
    });
    return { body: normalizeTextBody(Buffer.concat(chunks)), attachmentId: attachment.id };
  }

  return {
    applyApprovedProposal: async (issueId: string, input: { workProductId?: string | null; attachmentId?: string | null }, actor: Actor): Promise<RoutineProposalApplyResult> => {
      const issue = await issuesSvc.getById(issueId);
      if (!issue) throw notFound("Issue not found");
      const { body, attachmentId } = await readArtifactBody(issueId, input);

      let artifactJson: unknown;
      try {
        artifactJson = JSON.parse(body);
      } catch {
        throw unprocessable("Proposal artifact is not valid JSON");
      }
      const parsed = routineProposalArtifactSchema.safeParse(artifactJson);
      if (!parsed.success) throw unprocessable("Proposal artifact failed validation", parsed.error.issues);
      if (parsed.data.companyId !== issue.companyId) throw conflict("Proposal artifact company does not match issue company");

      const results: ProposalResult[] = [];
      for (const proposal of parsed.data.proposals) {
        const sameTitle = await db.select().from(routines)
          .where(and(eq(routines.companyId, issue.companyId), eq(routines.parentIssueId, issueId), eq(routines.title, proposal.title)));

        const exact = sameTitle.find((row) => row.assigneeAgentId === proposal.assigneeAgentId && row.projectId === proposal.projectId) ?? null;
        const conflicting = sameTitle.find((row) => row.assigneeAgentId !== proposal.assigneeAgentId || row.projectId !== proposal.projectId) ?? null;
        if (conflicting) {
          results.push({ proposalKey: proposal.proposalKey, title: proposal.title, outcome: "rejected", reason: "Existing routine title conflicts with assignee/project mapping" });
          continue;
        }

        if (!exact) {
          const created = await routinesSvc.create(issue.companyId, {
            projectId: proposal.projectId,
            goalId: proposal.goalId ?? null,
            parentIssueId: issueId,
            title: proposal.title,
            description: proposal.purpose,
            assigneeAgentId: proposal.assigneeAgentId,
            priority: proposal.priority,
            status: "active",
            concurrencyPolicy: proposal.concurrencyPolicy,
            catchUpPolicy: proposal.catchUpPolicy,
            variables: proposal.variables,
            env: proposal.env ?? null,
          }, actor);
          await routinesSvc.createTrigger(created.id, toCreateTriggerInput(proposal.schedule), actor);
          results.push({ proposalKey: proposal.proposalKey, title: proposal.title, outcome: "created", routineId: created.id });
          continue;
        }

        const updated = await routinesSvc.update(exact.id, {
          projectId: proposal.projectId,
          goalId: proposal.goalId ?? null,
          parentIssueId: issueId,
          title: proposal.title,
          description: proposal.purpose,
          assigneeAgentId: proposal.assigneeAgentId,
          priority: proposal.priority,
          concurrencyPolicy: proposal.concurrencyPolicy,
          catchUpPolicy: proposal.catchUpPolicy,
          variables: proposal.variables,
          env: proposal.env ?? null,
          baseRevisionId: exact.latestRevisionId,
        }, actor);
        if (!updated) throw notFound("Routine disappeared during reconciliation");

        const triggers = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, exact.id));
        const primary = triggers[0] ?? null;
        if (!primary) {
          await routinesSvc.createTrigger(exact.id, toCreateTriggerInput(proposal.schedule), actor);
          results.push({ proposalKey: proposal.proposalKey, title: proposal.title, outcome: "updated", routineId: exact.id });
          continue;
        }
        if (triggers.length > 1) {
          results.push({ proposalKey: proposal.proposalKey, title: proposal.title, outcome: "rejected", reason: "Routine has multiple triggers; apply supports single-trigger reconciliation" });
          continue;
        }

        const triggerChanged = !triggerEqualsProposal(primary, proposal.schedule);
        if (triggerChanged) {
          if (proposal.schedule.kind !== primary.kind) {
            await routinesSvc.deleteTrigger(primary.id, actor);
            await routinesSvc.createTrigger(exact.id, toCreateTriggerInput(proposal.schedule), actor);
          } else {
            await routinesSvc.updateTrigger(primary.id, toUpdateTriggerInput(proposal.schedule), actor);
          }
        }

        const changed = triggerChanged
          || updated.description !== proposal.purpose
          || updated.assigneeAgentId !== proposal.assigneeAgentId
          || updated.projectId !== proposal.projectId
          || updated.goalId !== (proposal.goalId ?? null)
          || updated.priority !== proposal.priority
          || updated.concurrencyPolicy !== proposal.concurrencyPolicy
          || updated.catchUpPolicy !== proposal.catchUpPolicy;
        results.push({ proposalKey: proposal.proposalKey, title: proposal.title, outcome: changed ? "updated" : "unchanged", routineId: exact.id });
      }

      const summary = {
        created: results.filter((entry) => entry.outcome === "created").length,
        updated: results.filter((entry) => entry.outcome === "updated").length,
        unchanged: results.filter((entry) => entry.outcome === "unchanged").length,
        rejected: results.filter((entry) => entry.outcome === "rejected").length,
      };
      await issuesSvc.addComment(issueId, proposalComment({ artifactSource: input.workProductId ? { workProductId: input.workProductId } : { attachmentId }, summary, results }), actor, {
        authorType: actor.agentId ? "agent" : "user",
      });
      return { artifactSource: input.workProductId ? { workProductId: input.workProductId } : { attachmentId }, summary, results };
    },
  };
}
