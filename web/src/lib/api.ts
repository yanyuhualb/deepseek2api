// API client — mirrors backend contract in src/routes/*.

export interface SessionPayload {
  authenticated: boolean;
  role?: "admin" | "local";
  ownerId?: string;
  username?: string;
  accounts?: Account[];
  apiKeys?: ApiKey[];
  adminEnabled?: boolean;
  registration?: { inviteRequired: boolean };
  incognito?: IncognitoState;
  adminData?: AdminData;
}

export interface Account {
  id: string;
  ownerId: string;
  loginValue: string;
  displayName: string;
  emailMasked: string;
  mobileMasked: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  ownerId: string;
  accountId: string;
  label: string;
  plainKey?: string;
  createdAt?: string;
}

export interface IncognitoState {
  effectiveEnabled: boolean;
  globalEnabled: boolean;
  ownerEnabled: boolean;
  scope: "global" | "self";
  scopeEnabled: boolean;
}

export interface Invite {
  id: string;
  code: string;
  createdAt: string;
  usedAt: string | null;
  usedByUsername: string;
}

export interface PublicUser {
  id: string;
  username: string;
  role: string;
  enabled: boolean;
  createdAt?: string;
}

export interface AdminData {
  invites: Invite[];
  registration: { inviteRequired: boolean };
  users: PublicUser[];
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok || payload?.error) {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  return payload as T;
}

export const api = {
  me: () => requestJson<SessionPayload>("/api/me"),

  login: (username: string, password: string) =>
    requestJson<SessionPayload>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),

  register: (username: string, password: string, inviteCode?: string) =>
    requestJson<SessionPayload>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, inviteCode })
    }),

  logout: () => requestJson<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  discovery: () => requestJson<{ paths: string[] }>("/api/discovery"),

  listAccounts: () => requestJson<{ accounts: Account[] }>("/api/accounts"),

  bindAccount: (username: string, password: string, deviceId: string) =>
    requestJson<{ account: Account }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ username, password, deviceId })
    }),

  deleteAccount: (id: string) =>
    requestJson<{ ok: true }>(`/api/accounts/${id}`, { method: "DELETE" }),

  setIncognito: (enabled: boolean) =>
    requestJson<{ incognito: IncognitoState }>("/api/incognito", {
      method: "POST",
      body: JSON.stringify({ enabled })
    }),

  listApiKeys: () => requestJson<{ apiKeys: ApiKey[] }>("/api/api-keys"),

  createApiKey: (accountId: string, label: string, plainKey: string) =>
    requestJson<ApiKey>("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ accountId, label, plainKey })
    }),

  deleteApiKey: (id: string) =>
    requestJson<{ ok: true }>(`/api/api-keys/${id}`, { method: "DELETE" }),

  // Admin
  setRegistration: (inviteRequired: boolean) =>
    requestJson<{ ok: true }>("/api/admin/registration", {
      method: "POST",
      body: JSON.stringify({ inviteRequired })
    }),

  createInvites: (count: number) =>
    requestJson<{ invites: Invite[] }>("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({ count })
    }),

  deleteInvites: (ids: string[]) =>
    requestJson<{ ok: true }>("/api/admin/invites/batch-delete", {
      method: "POST",
      body: JSON.stringify({ inviteIds: ids })
    }),

  deleteInvite: (id: string) =>
    requestJson<{ ok: true }>(`/api/admin/invites/${id}`, { method: "DELETE" }),

  setUserEnabled: (id: string, enabled: boolean) =>
    requestJson<{ ok: true }>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    }),

  deleteUser: (id: string) =>
    requestJson<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" }),

  batchDisableUsers: (ids: string[]) =>
    requestJson<{ ok: true }>("/api/admin/users/batch-disable", {
      method: "POST",
      body: JSON.stringify({ userIds: ids })
    }),

  batchDeleteUsers: (ids: string[]) =>
    requestJson<{ ok: true }>("/api/admin/users/batch-delete", {
      method: "POST",
      body: JSON.stringify({ userIds: ids })
    })
};

// Proxy (DeepSeek native API passthrough) — uses login session, not API key.
export async function proxyJson<T>(
  path: string,
  options: { method?: string; body?: any; query?: Record<string, string>; accountId?: string } = {}
): Promise<T> {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
  const res = await fetch(`/proxy${path}${query}`, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-proxy-account-id": options.accountId || ""
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const bizCode = payload?.data?.biz_code;
  if (!res.ok || payload?.error || (typeof bizCode === "number" && bizCode !== 0)) {
    throw new Error(payload?.data?.biz_msg || payload?.error || payload?.msg || `HTTP ${res.status}`);
  }
  return payload as T;
}

export async function proxyUpload(
  path: string,
  file: File,
  accountId: string
): Promise<any> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/proxy${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-proxy-account-id": accountId },
    body: form
  });
  const text = await res.text();
  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  const bizCode = payload?.data?.biz_code;
  if (!res.ok || payload?.error || (typeof bizCode === "number" && bizCode !== 0)) {
    throw new Error(payload?.data?.biz_msg || payload?.error || `HTTP ${res.status}`);
  }
  return payload;
}
