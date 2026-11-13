export type CallerRole = 'public' | 'agent' | 'admin';

export type StatusTone = 'ok' | 'warn' | 'ko' | 'unk';

export type StatusCode =
  | 'VALIDE'
  | 'PROVISOIRE'
  | 'EXPIRE'
  | 'PERMIS_EXPIRE'
  | 'SUSPENDU'
  | 'INCONNU';

export interface VerificationStatus {
  code: StatusCode;
  tone: StatusTone;
  titre: string;
  sous: string;
  joursRestants?: number;
  serverTime: string;
}

export interface MinimizedDriver {
  badgeNumero: string;
  prenoms: string;
  photoURL: string;
  // Agent & Admin fields
  nom?: string;
  typeBadge?: 'permis' | 'provisoire';
  dateExpiration?: string | null;
  permisExpiration?: string | null;
  plaqueMoto?: string;
  permisMasque?: string;
  suspendu?: boolean;
  // Admin-only fields
  driverId?: string;
  telephone?: string;
  quartier?: string;
  permisNumero?: string;
  shortCode?: string;
}

export interface VerifyResponse {
  role: CallerRole;
  statut: VerificationStatus;
  driver: MinimizedDriver | null;
}

export interface AgentSession {
  agentId: string;
  nom: string;
  corps: string;
  matricule: string;
  role: 'agent' | 'admin';
  token: string;
  expiresAt: string;
}

export interface ControlLogEntry {
  id: string;
  date: string;
  role: CallerRole;
  agentId: string | null;
  agentNom: string;
  corps: string;
  driverId: string | null;
  badgeNumero: string;
  driverName: string;
  statutCode: StatusCode | 'JETON_INCONNU';
  tone: StatusTone;
  method: 'qr' | 'manual';
}

export interface TestBadgeSample {
  badgeNumero: string;
  shortCode: string;
  qrToken: string;
  driverName: string;
  expectedLabel: string;
  tone: StatusTone;
  typeBadge: 'permis' | 'provisoire';
}

export interface AdminDriverRecord {
  driverId: string;
  badgeNumero: string;
  shortCode: string;
  nom: string;
  prenoms: string;
  photoURL: string;
  typeBadge: 'permis' | 'provisoire';
  dateEmission: string;
  dateExpiration: string | null;
  permisNumero: string;
  permisExpiration: string | null;
  suspendu: boolean;
  motifSuspension?: string;
  plaqueMoto: string;
  quartier: string;
  telephone: string;
  statut: VerificationStatus;
}

export interface AdminAgentRecord {
  agentId: string;
  nom: string;
  corps: string;
  matricule: string;
  role: 'agent' | 'admin';
  actif: boolean;
  codeHint: string;
  creeLe: string;
}
