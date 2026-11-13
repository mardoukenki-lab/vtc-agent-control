import type {
  AdminAgentRecord,
  AdminDriverRecord,
  AgentSession,
  ControlLogEntry,
  TestBadgeSample,
  VerifyResponse,
} from '../types';

const SESSION_KEY = 'allodabou_agent_session';

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
    if (fromHash) return { token: fromHash };
    const fromSearch =
      url.searchParams.get('t') || url.searchParams.get('v') || url.searchParams.get('id');
    if (fromSearch) {
      return /^[A-Za-z0-9_-]{16,64}$/.test(fromSearch)
        ? { token: fromSearch }
        : { manualCode: fromSearch };
    }
    const seg = url.pathname.split('/').filter(Boolean).pop();
    if (seg) {
      return /^[A-Za-z0-9_-]{16,64}$/.test(seg) ? { token: seg } : { manualCode: seg };
    }
  } catch {
    // Not a URL — treat as raw token or manual badge code
  }
  if (/^[A-Za-z0-9_-]{16,64}$/.test(trimmed)) {
    return { token: trimmed };
  }
  return { manualCode: trimmed.toUpperCase() };
}

export const api = {
  login: (code: string) =>
    request<AgentSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  me: (token: string) =>
    request<Omit<AgentSession, 'token' | 'expiresAt'>>('/api/auth/me', {}, token),

  verify: (payload: { token?: string; manualCode?: string }, authToken?: string | null) =>
    request<VerifyResponse>(
      '/api/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      authToken
    ),

  getControls: (authToken: string) =>
    request<{ controls: ControlLogEntry[] }>('/api/controls', {}, authToken),

  getTestBadges: () => request<{ badges: TestBadgeSample[] }>('/api/test-badges'),

  adminGetDrivers: (authToken: string) =>
    request<{ drivers: AdminDriverRecord[] }>('/api/admin/drivers', {}, authToken),

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
    },
    authToken: string
  ) =>
    request<{ driver: AdminDriverRecord; qrToken: string }>(
      '/api/admin/drivers',
      { method: 'POST', body: JSON.stringify(payload) },
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
};
