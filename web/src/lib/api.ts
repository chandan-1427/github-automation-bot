const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include", // send the session cookie cross-origin
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type User = {
  id: number;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type ActionLog = {
  id: number;
  actionType: string;
  target: string | null;
  status: string;
  lastError: string | null;
};

export type EventRow = {
  id: number;
  eventType: string;
  action: string | null;
  repoFullName: string;
  status: string;
  receivedAt: string;
  aiSummary: string | null;
  aiSuggestedLabel: string | null;
  aiPriority: string | null;
  title: string | null;
  actions: ActionLog[];
};

export type RepoOption = {
  githubRepoId: number;
  fullName: string;
  enabled: boolean;
  ourRepoId: number | null;
};

export type InstallationWithRepos = {
  installationId: number;
  accountLogin: string;
  repos: RepoOption[];
};

export type Rule = {
  id: number;
  userId: number;
  repoId: number | null;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: {
    eventTypes: string[];
    matches: { field: string; type: string; value: string }[];
  };
  actions: {
    addLabel?: string;
    comment?: string;
    slackAlert?: boolean;
  };
};

export const api = {
  loginUrl: () => `${API_BASE}/auth/github/login`,
  me: () => request<{ user: User }>("/auth/me"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  installStart: () => request<{ url: string }>("/install/start"),
  installRepos: () => request<{ installations: InstallationWithRepos[] }>("/install/repos"),
  enableRepo: (githubRepoId: number, installationId: number, fullName: string) =>
    request<{ ok: true }>(`/install/repos/${githubRepoId}/enable`, {
      method: "POST",
      body: JSON.stringify({ installationId, fullName }),
    }),
  disableRepo: (githubRepoId: number) =>
    request<{ ok: true }>(`/install/repos/${githubRepoId}/disable`, { method: "POST" }),

  events: (limit = 50) => request<{ events: EventRow[] }>(`/dashboard/events?limit=${limit}`),

  rules: () => request<{ rules: Rule[] }>("/rules"),
  createRule: (rule: Partial<Rule>) =>
    request<{ rule: Rule }>("/rules", { method: "POST", body: JSON.stringify(rule) }),
  updateRule: (id: number, rule: Partial<Rule>) =>
    request<{ rule: Rule }>(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(rule) }),
  deleteRule: (id: number) => request<{ ok: true }>(`/rules/${id}`, { method: "DELETE" }),
  getSettings: () => request<{ slackWebhookUrl: string | null }>("/settings"),
  updateSettings: (slackWebhookUrl: string | null) =>
    request<{ ok: true }>("/settings", { method: "PATCH", body: JSON.stringify({ slackWebhookUrl }) }),
};
