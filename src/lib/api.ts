import type {
  AdminAgentRecord,
  AdminDriverRecord,
  AgentSession,
  ControlLogEntry,
  VerifyResponse,
} from '../types';

const SESSION_KEY = 'allodabou_agent_session';

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export function loadStoredSession(): AgentSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentSession;
    if (!parsed?.token || (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now())) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: AgentSession | null): void {
  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new UnauthorizedError(data.error || 'Session expirée, veuillez vous reconnecter.');
  }
  if (!res.ok) {
    throw new Error(data.error || `Erreur serveur (${res.status})`);
  }
  return data as T;
}

export function extractQrTarget(raw: string): { token?: string; manualCode?: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};
  try {
    const url = new URL(trimmed);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const fromHash = hashParams.get('t') || hashParams.get('token');
    if (fromHash && /^[A-Za-z0-9_-]{16,64}$/.test(fromHash)) {
      return { token: fromHash };
    }
    const fromSearch = url.searchParams.get('t') || url.searchParams.get('token');
    if (fromSearch && /^[A-Za-z0-9_-]{16,64}$/.test(fromSearch)) {
      return { token: fromSearch };
    }
    const seg = url.pathname.split('/').filter(Boolean).pop();
    if (seg && /^[A-Za-z0-9_-]{16,64}$/.test(seg)) {
      return { token: seg };
    }
    return {};
  } catch {
    if (/^[A-Za-z0-9_-]{16,64}$/.test(trimmed)) {
      return { token: trimmed };
    }
    return { manualCode: trimmed.toUpperCase() };
  }
}

export const api = {
  getSetupStatus: () => request<{ needsBootstrap: boolean }>('/api/setup/status'),

  bootstrapAdmin: (payload: { nom: string; corps: string; matricule: string }) =>
    request<{ agent: AdminAgentRecord; rawCode: string }>('/api/setup/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (code: string) =>
    request<AgentSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  me: (token: string) =>
    request<Omit<AgentSession, 'token' | 'expiresAt'>>('/api/auth/me', {}, token),

  logout: (token: string) =>
    request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, token).catch(() => ({
      ok: true,
    })),

  verify: (payload: { token?: string; manualCode?: string }, authToken?: string | null) =>
    request<VerifyResponse>(
      '/api/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      authToken
    ),

  getControls: (authToken: string, params?: { q?: string; type?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.type) sp.set('type', params.type);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<{ controls: ControlLogEntry[]; total: number }>(
      `/api/controls${qs}`,
      {},
      authToken
    );
  },

  adminGetDrivers: (authToken: string, params?: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.status && params.status !== 'all') sp.set('status', params.status);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<{ drivers: AdminDriverRecord[]; total: number }>(
      `/api/admin/drivers${qs}`,
      {},
      authToken
    );
  },

  adminCreateDriver: (
    payload: {
      nom: string;
      prenoms: string;
      plaqueMoto: string;
      quartier: string;
      telephone: string;
      typeBadge: 'permis' | 'provisoire';
      permisNumero?: string;
      permisExpiration?: string;
      photoDataUrl?: string;
    },
    authToken: string
  ) =>
    request<{ driver: AdminDriverRecord; qrToken: string }>(
      '/api/admin/drivers',
      { method: 'POST', body: JSON.stringify(payload) },
      authToken
    ),

  adminUpdateDriver: (
    driverId: string,
    payload: {
      nom?: string;
      prenoms?: string;
      plaqueMoto?: string;
      quartier?: string;
      telephone?: string;
      typeBadge?: 'permis' | 'provisoire';
      permisNumero?: string;
      permisExpiration?: string;
      renewProvisoire?: boolean;
      photoDataUrl?: string;
    },
    authToken: string
  ) =>
    request<{ driver: AdminDriverRecord }>(
      `/api/admin/drivers/${encodeURIComponent(driverId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      authToken
    ),

  adminToggleSuspend: (
    driverId: string,
    suspendu: boolean,
    motif: string,
    authToken: string
  ) =>
    request<{ driver: AdminDriverRecord }>(
      `/api/admin/drivers/${encodeURIComponent(driverId)}/suspend`,
      { method: 'POST', body: JSON.stringify({ suspendu, motif }) },
      authToken
    ),

  adminReissueBadge: (driverId: string, authToken: string) =>
    request<{ driver: AdminDriverRecord; qrToken: string }>(
      `/api/admin/drivers/${encodeURIComponent(driverId)}/reissue`,
      { method: 'POST' },
      authToken
    ),

  adminGetAgents: (authToken: string) =>
    request<{ agents: AdminAgentRecord[] }>('/api/admin/agents', {}, authToken),

  adminCreateAgent: (
    payload: { nom: string; corps: string; matricule: string; role: 'agent' | 'admin' },
    authToken: string
  ) =>
    request<{ agent: AdminAgentRecord; rawCode: string }>(
      '/api/admin/agents',
      { method: 'POST', body: JSON.stringify(payload) },
      authToken
    ),

  adminToggleAgent: (agentId: string, actif: boolean, authToken: string) =>
    request<{ agent: AdminAgentRecord }>(
      `/api/admin/agents/${encodeURIComponent(agentId)}`,
      { method: 'PATCH', body: JSON.stringify({ actif }) },
      authToken
    ),

  adminExportAuditCsv: async (authToken: string) => {
    const res = await fetch('/api/admin/audit/export', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.status === 401) {
      throw new UnauthorizedError('Session expirée, veuillez vous reconnecter.');
    }
    if (!res.ok) {
      throw new Error('Export CSV impossible.');
    }
    return res.blob();
  },

  adminPurgeAudit: (retentionDays: number, authToken: string) =>
    request<{ purgedCount: number; remainingCount: number }>(
      '/api/admin/audit/purge',
      { method: 'POST', body: JSON.stringify({ retentionDays }) },
      authToken
    ),
};
