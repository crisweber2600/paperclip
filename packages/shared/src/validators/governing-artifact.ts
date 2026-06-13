import { z } from "zod";

export const governingArtifactReferenceKindSchema = z.enum(["document_revision", "work_product"]);

export const governingArtifactReferenceSchema = z.object({
  kind: governingArtifactReferenceKindSchema,
  artifactId: z.string().uuid(),
  label: z.string().trim().min(1).max(200).optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  revisionId: z.string().uuid().optional().nullable(),
  workProductId: z.string().uuid().optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "document_revision") {
    if (!value.documentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is required for document_revision references" });
    }
    if (!value.revisionId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisionId"], message: "revisionId is required for document_revision references" });
    }
    if (value.workProductId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workProductId"], message: "workProductId is not allowed for document_revision references" });
    }
    if (value.artifactId !== value.revisionId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["artifactId"], message: "artifactId must equal revisionId for document_revision references" });
    }
    return;
  }

  if (!value.workProductId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workProductId"], message: "workProductId is required for work_product references" });
  }
  if (value.documentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is not allowed for work_product references" });
  }
  if (value.revisionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revisionId"], message: "revisionId is not allowed for work_product references" });
  }
  if (value.artifactId !== value.workProductId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["artifactId"], message: "artifactId must equal workProductId for work_product references" });
  }
});

export const acceptanceEvidenceEntrySchema = z.object({
  id: z.string().uuid().optional().nullable(),
  kind: z.enum(["document_revision", "work_product", "comment", "issue"]),
  artifactId: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000).optional().nullable(),
  recordedAt: z.union([z.date(), z.string().datetime()]).optional().nullable(),
}).strict();

export const governingArtifactReferenceListSchema = z.array(governingArtifactReferenceSchema).max(50);
export const acceptanceEvidenceEntryListSchema = z.array(acceptanceEvidenceEntrySchema).max(100);

export type GoverningArtifactReference = z.infer<typeof governingArtifactReferenceSchema>;
export type AcceptanceEvidenceEntry = z.infer<typeof acceptanceEvidenceEntrySchema>;
