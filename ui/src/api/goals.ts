import type { GoalOperatorView } from "@paperclipai/shared";
import { api } from "./client";

export const goalsApi = {
  list: (companyId: string) => api.get<GoalOperatorView[]>(`/companies/${companyId}/goals`),
  get: (id: string) => api.get<GoalOperatorView>(`/goals/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<GoalOperatorView>(`/companies/${companyId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<GoalOperatorView>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<GoalOperatorView>(`/goals/${id}`),
};
