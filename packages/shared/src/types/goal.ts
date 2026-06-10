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
