ALTER TABLE "issues"
  ADD COLUMN "governing_artifacts" jsonb,
  ADD COLUMN "acceptance_evidence" jsonb;

ALTER TABLE "projects"
  ADD COLUMN "governing_artifacts" jsonb,
  ADD COLUMN "acceptance_evidence" jsonb;
