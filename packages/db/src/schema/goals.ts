import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    title: text("title").notNull(),
    description: text("description"),
    level: text("level").notNull().default("task"),
    status: text("status").notNull().default("planned"),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    lastVerdict: text("last_verdict"),
    lastVerdictReason: text("last_verdict_reason"),
    lastVerdictAt: timestamp("last_verdict_at", { withTimezone: true }),
    // Null when a future server-side judge records the verdict.
    lastVerdictByAgentId: uuid("last_verdict_by_agent_id").references(() => agents.id),
    verdictStreak: integer("verdict_streak").notNull().default(0),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("goals_company_idx").on(table.companyId),
  }),
);
