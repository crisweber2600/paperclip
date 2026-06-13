import { describe, expect, it } from "vitest";
import {
  generateDocsToRoutinesProposalSchema,
  requestDocsToRoutinesProposalReviewSchema,
} from "./docs-to-routines.js";

describe("generateDocsToRoutinesProposalSchema", () => {
  it("applies safe defaults", () => {
    expect(generateDocsToRoutinesProposalSchema.parse({})).toEqual({
      corpus: {
        references: [],
        defaults: {
          concurrencyPolicy: "coalesce_if_active",
          catchUpPolicy: "skip_missed",
          timezone: "UTC",
        },
      },
    });
  });
});

describe("requestDocsToRoutinesProposalReviewSchema", () => {
  it("defaults to waking the assignee on approval", () => {
    expect(requestDocsToRoutinesProposalReviewSchema.parse({
      proposalDocumentKey: "routine-proposal",
      prompt: "Approve this routine proposal?",
    })).toMatchObject({
      continuationPolicy: "wake_assignee_on_accept",
    });
  });
});
