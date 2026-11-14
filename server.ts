import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type {
  AdminDriverRecord,
  CallerRole,
  ControlLogEntry,
  MinimizedDriver,
  StatusTone,
  VerificationStatus,
} from './src/types';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DAY_MS = 86_400_000;
const SESSION_TTL_MS = 2 * 60 * 60_000; // 2 hours revocable patrol shift
const DATA_DIR = path.resolve(process.cwd(), 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.ndjson');
const DEV_SECRET_PATH = path.join(DATA_DIR, '.dev-secret');

function ensureDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

function resolveSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim() || '';
  if (IS_PROD) {
    if (envSecret.length < 32) {
      throw new Error(
        'FATAL: SESSION_SECRET (>= 32 caractères) est obligatoire en production.'
      );
    }
    return envSecret;
  }
  if (envSecret.length >= 32) return envSecret;

  ensureDataDirs();
  if (fs.existsSync(DEV_SECRET_PATH)) {
    const existing = fs.readFileSync(DEV_SECRET_PATH, 'utf-8').trim();
    if (existing.length >= 32) return existing;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(DEV_SECRET_PATH, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = resolveSessionSecret();

interface DriverRecord {
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
  creeLe: string;
  modifieLe?: string;
}

interface BadgeTokenRecord {
  tokenHash: string;
  driverId: string;
  revoque: boolean;
  creeLe: string;
  revoqueLe?: string;
}

interface AgentRecord {
  agentId: string;
  nom: string;
  corps: string;
  matricule: string;
  role: 'agent' | 'admin';
  actif: boolean;
  codeHint: string;
  creeLe: string;
}

interface AgentCodeRecord {
  codeHash: string;
  agentId: string;
  actif: boolean;
  expireLe: string | null;
}

interface ActiveSessionRecord {
  jti: string;
  agentId: string;
  exp: number;
}

interface StoreData {
  badgeCounter: number;
  drivers: Record<string, DriverRecord>;
  badgeTokens: Record<string, BadgeTokenRecord>;
  agents: Record<string, AgentRecord>;
  agentCodes: Record<string, AgentCodeRecord>;
  activeSessions: Record<string, ActiveSessionRecord>;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacAgentCode(rawCode: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(rawCode).digest('hex');
}

function generateQrToken(): string {
  return crypto.randomBytes(16).toString('base64url'); // 22 chars cryptographic token
}

function generateShortCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

// 12 random base32 chars (~60 bits entropy) formatted as PREF-XXXX-XXXX-XXXX
function generateAgentCode(prefix: string): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(12);
  const groups = ['', '', ''];
  for (let i = 0; i < 12; i++) {
    groups[Math.floor(i / 4)] += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${groups[0]}-${groups[1]}-${groups[2]}`;
}

function maskPermis(permis: string): string {
  const trimmed = String(permis || '').trim();
  if (!trimmed) return 'Non fourni';
  if (trimmed.length <= 4) return '****';
  return `***${trimmed.slice(-4)}`;
}

function formatDateFr(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function createEmptyStore(): StoreData {
  return {
    badgeCounter: 1,
    drivers: {},
    badgeTokens: {},
    agents: {},
    agentCodes: {},
    activeSessions: {},
  };
}

function loadStore(): StoreData {
  ensureDataDirs();
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      if (parsed && parsed.drivers && parsed.badgeTokens && parsed.agents && parsed.agentCodes) {
        return {
          badgeCounter: parsed.badgeCounter || 1,
          drivers: parsed.drivers,
          badgeTokens: parsed.badgeTokens,
          agents: parsed.agents,
          agentCodes: parsed.agentCodes,
          activeSessions: parsed.activeSessions || {},
        };
      }
    }
  } catch (err) {
    console.warn('Store load fallback:', err);
  }
  const initial = createEmptyStore();
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreData): void {
  ensureDataDirs();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function appendAuditLog(entry: ControlLogEntry): void {
  ensureDataDirs();
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`, 'utf-8');
}

function readAuditLogs(): ControlLogEntry[] {
  if (!fs.existsSync(AUDIT_PATH)) return [];
  const raw = fs.readFileSync(AUDIT_PATH, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const items: ControlLogEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      items.push(JSON.parse(lines[i]) as ControlLogEntry);
    } catch {
      // skip malformed line
    }
  }
  return items;
}

function parseValidDate(input: unknown): Date | null {
  if (typeof input !== 'string' && !(input instanceof Date)) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function savePhotoDataUrl(driverId: string, dataUrl: string): string {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw new Error('Format de photo invalide (JPEG, PNG ou WebP uniquement).');
  }
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 350 * 1024) {
    throw new Error('Photo trop volumineuse (350 Ko maximum après compression).');
  }
  ensureDataDirs();
  const fileName = `${driverId}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, fileName), buf);
  return `/api/photos/${fileName}`;
}

const store: StoreData = loadStore();

// Server-side status calculation using server clock ONLY.
// End-of-day inclusive rule: a badge expiring on date D remains valid until 23:59:59 UTC+0 (Abidjan/Dabou time).
function computeDriverStatus(d: DriverRecord, now: Date): VerificationStatus {
  const serverTime = now.toISOString();
  if (d.suspendu) {
    return {
      code: 'SUSPENDU',
      tone: 'ko',
      titre: 'SUSPENDU',
      sous: d.motifSuspension || 'Ce badge a été suspendu par les autorités.',
      serverTime,
    };
  }

  const endOfDayMs = (date: Date) => {
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return end.getTime();
  };

  if (d.typeBadge === 'permis') {
    const pe = d.permisExpiration ? new Date(d.permisExpiration) : null;
    if (!pe || Number.isNaN(pe.getTime())) {
      return {
        code: 'INCONNU',
        tone: 'unk',
        titre: 'STATUT INCONNU',
        sous: 'Date de validité du permis manquante.',
        serverTime,
      };
    }
    if (endOfDayMs(pe) < now.getTime()) {
      return {
        code: 'PERMIS_EXPIRE',
        tone: 'ko',
        titre: 'PERMIS EXPIRÉ',
        sous: `Permis expiré le ${formatDateFr(pe)}. Circulation non autorisée.`,
        serverTime,
      };
    }
    return {
      code: 'VALIDE',
      tone: 'ok',
      titre: 'VALIDE',
      sous: `Titulaire d'un permis valable jusqu'au ${formatDateFr(pe)}.`,
      serverTime,
    };
  }

  const ex = d.dateExpiration ? new Date(d.dateExpiration) : null;
  if (!ex || Number.isNaN(ex.getTime())) {
    return {
      code: 'INCONNU',
      tone: 'unk',
      titre: 'STATUT INCONNU',
      sous: 'Date de fin de validité du badge provisoire manquante.',
      serverTime,
    };
  }
  const exEnd = endOfDayMs(ex);
  if (exEnd < now.getTime()) {
    return {
      code: 'EXPIRE',
      tone: 'ko',
      titre: 'EXPIRÉ',
      sous: `Badge provisoire expiré le ${formatDateFr(ex)}. Permis requis.`,
      serverTime,
    };
  }

  const joursRestants = Math.max(1, Math.ceil((exEnd - now.getTime()) / DAY_MS));
  return {
    code: 'PROVISOIRE',
    tone: 'warn',
    titre: 'PROVISOIRE',
    sous: `Valable jusqu'au ${formatDateFr(ex)} (${joursRestants} jour${
      joursRestants > 1 ? 's' : ''
    }) — permis à régulariser.`,
    joursRestants,
    serverTime,
  };
}

function minimizeDriver(d: DriverRecord, role: CallerRole): MinimizedDriver {
  const base: MinimizedDriver = {
    badgeNumero: d.badgeNumero,
    prenoms: d.prenoms,
    photoURL: d.photoURL,
  };
  if (role === 'public') return base;

  const agentView: MinimizedDriver = {
    ...base,
    nom: d.nom,
    typeBadge: d.typeBadge,
    dateExpiration: d.dateExpiration,
    permisExpiration: d.permisExpiration,
    plaqueMoto: d.plaqueMoto,
    permisMasque: maskPermis(d.permisNumero),
    suspendu: d.suspendu,
  };
  if (role === 'agent') return agentView;

  return {
    ...agentView,
    driverId: d.driverId,
    telephone: d.telephone,
    quartier: d.quartier,
    permisNumero: d.permisNumero || 'Non fourni',
    shortCode: d.shortCode,
  };
}

interface TokenPayload {
  jti: string;
  agentId: string;
  role: 'agent' | 'admin';
  exp: number;
}

function signSessionToken(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  let changed = false;
  for (const [jti, sess] of Object.entries(store.activeSessions)) {
    if (sess.exp < now) {
      delete store.activeSessions[jti];
      changed = true;
    }
  }
  if (changed) saveStore(store);
}

function verifySessionToken(token: string): { agent: AgentRecord; jti: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as TokenPayload;
    if (!payload.jti || !payload.agentId || !payload.exp || payload.exp < Date.now()) {
      return null;
    }

    const active = store.activeSessions[payload.jti];
    if (!active || active.exp < Date.now() || active.agentId !== payload.agentId) {
      return null;
    }

    const agent = store.agents[payload.agentId];
    if (!agent || !agent.actif) return null;
    return { agent, jti: payload.jti };
  } catch {
    return null;
  }
}

const rateBuckets = new Map<string, number[]>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return true;
}

interface AuthedRequest extends Request {
  agent?: AgentRecord | null;
  sessionJti?: string | null;
}

function resolveOptionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const verified = verifySessionToken(auth.slice(7).trim());
    req.agent = verified?.agent || null;
    req.sessionJti = verified?.jti || null;
  } else {
    req.agent = null;
    req.sessionJti = null;
  }
  next();
}

function requireAgent(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.agent) {
    res.status(401).json({ error: 'Authentification agent requise ou session expirée.' });
    return;
  }
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.agent || req.agent.role !== 'admin') {
    res.status(403).json({ error: 'Accès réservé aux administrateurs habilités.' });
    return;
  }
  next();
}

function hasAnyAdmin(): boolean {
  return Object.values(store.agents).some((a) => a.role === 'admin');
}

function validatePlateAndPhone(plaque: string, telephone: string): string | null {
  if (plaque.length < 4 || plaque.length > 20 || !/^[A-Z0-9\s-]+$/i.test(plaque)) {
    return 'Format de plaque moto invalide (ex: 1234 AB 01).';
  }
  if (telephone && !/^[+0-9\s-]{8,20}$/.test(telephone)) {
    return 'Format de téléphone invalide.';
  }
  return null;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '600kb' }));

  // Hardened HTTP security headers
  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const csp = [
      "default-src 'self'",
      IS_PROD ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      IS_PROD ? "frame-ancestors 'none'" : "frame-ancestors *",
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);
    next();
  });

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
  });

  app.use(resolveOptionalAuth);

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, serverTime: new Date().toISOString() });
  });

  // Serve uploaded driver photos safely
  app.get('/api/photos/:filename', (req, res) => {
    const filename = String(req.params.filename || '');
    if (!/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filename)) {
      res.status(400).json({ error: 'Nom de fichier invalide.' });
      return;
    }
    const fullPath = path.join(PHOTOS_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Photo introuvable.' });
      return;
    }
    res.sendFile(fullPath);
  });

  // First-time Admin Bootstrap (ONLY active when zero admins exist in store)
  app.get('/api/setup/status', (_req, res) => {
    res.json({ needsBootstrap: !hasAnyAdmin() });
  });

  app.post('/api/setup/bootstrap', (req, res) => {
    if (hasAnyAdmin()) {
      res.status(403).json({
        error: 'Initialisation déjà effectuée. Connectez-vous avec un compte administrateur.',
      });
      return;
    }
    const nom = String(req.body?.nom ?? '').trim();
    const corps = String(req.body?.corps ?? '').trim() || 'Autorité Municipale · Allô Dabou';
    const matricule = String(req.body?.matricule ?? '').trim().toUpperCase();

    if (nom.length < 3 || matricule.length < 3) {
      res.status(400).json({ error: 'Nom complet et matricule requis (3 caractères min.).' });
      return;
    }

    const rawCode = generateAgentCode('ADM');
    const codeHint = `ADM-****-${rawCode.slice(-4)}`;
    const agentId = `agt_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const admin: AgentRecord = {
      agentId,
      nom,
      corps,
      matricule,
      role: 'admin',
      actif: true,
      codeHint,
      creeLe: nowIso,
    };

    const codeHash = hmacAgentCode(rawCode);
    store.agents[agentId] = admin;
    store.agentCodes[codeHash] = {
      codeHash,
      agentId,
      actif: true,
      expireLe: null,
    };
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: nowIso,
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId,
      agentNom: nom,
      corps,
      driverId: null,
      badgeNumero: '—',
      driverName: nom,
      statutCode: 'AMORCAGE_ADMIN',
      tone: 'ok',
      method: 'admin',
      detail: `Création du premier administrateur (${matricule})`,
    });

    res.status(201).json({ agent: admin, rawCode });
  });

  // Agent login via individual HMAC-hashed access code
  app.post('/api/auth/login', (req: AuthedRequest, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`login:${ip}`, 10, 5 * 60_000)) {
      res.status(429).json({
        error: 'Trop de tentatives de connexion. Patientez 5 minutes avant de réessayer.',
      });
      return;
    }

    const rawCode = String(req.body?.code ?? '').trim().toUpperCase();
    if (rawCode.length < 10 || rawCode.length > 64) {
      res.status(400).json({ error: 'Format de code agent invalide.' });
      return;
    }

    const hash = hmacAgentCode(rawCode);
    const codeEntry = store.agentCodes[hash];
    if (!codeEntry || !codeEntry.actif) {
      res.status(401).json({ error: 'Code invalide ou désactivé.' });
      return;
    }
    if (codeEntry.expireLe && new Date(codeEntry.expireLe).getTime() < Date.now()) {
      res.status(401).json({ error: 'Code expiré. Demandez un renouvellement.' });
      return;
    }

    const agent = store.agents[codeEntry.agentId];
    if (!agent || !agent.actif) {
      res.status(401).json({ error: 'Compte agent désactivé.' });
      return;
    }

    cleanupExpiredSessions();
    const jti = crypto.randomBytes(12).toString('hex');
    const expiresAtMs = Date.now() + SESSION_TTL_MS;
    store.activeSessions[jti] = {
      jti,
      agentId: agent.agentId,
      exp: expiresAtMs,
    };
    saveStore(store);

    const token = signSessionToken({
      jti,
      agentId: agent.agentId,
      role: agent.role,
      exp: expiresAtMs,
    });

    res.json({
      agentId: agent.agentId,
      nom: agent.nom,
      corps: agent.corps,
      matricule: agent.matricule,
      role: agent.role,
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  });

  app.get('/api/auth/me', requireAgent, (req: AuthedRequest, res: Response) => {
    const agent = req.agent!;
    res.json({
      agentId: agent.agentId,
      nom: agent.nom,
      corps: agent.corps,
      matricule: agent.matricule,
      role: agent.role,
    });
  });

  // Server-side revocable logout
  app.post('/api/auth/logout', (req: AuthedRequest, res: Response) => {
    if (req.sessionJti && store.activeSessions[req.sessionJti]) {
      delete store.activeSessions[req.sessionJti];
      saveStore(store);
    }
    res.json({ ok: true });
  });

  // Badge verification endpoint (QR token or agent-only manual fallback)
  app.post('/api/verify', (req: AuthedRequest, res: Response) => {
    const ip = req.ip || 'unknown';
    const agent = req.agent;
    const callerKey = agent ? `agt:${agent.agentId}` : `ip:${ip}`;
    const role: CallerRole = agent ? agent.role : 'public';

    if (!checkRateLimit(`verify:${callerKey}`, 60, 60_000)) {
      res.status(429).json({
        error: 'Limite de requêtes atteinte. Patientez quelques secondes.',
      });
      return;
    }

    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const rawManual =
      typeof req.body?.manualCode === 'string' ? req.body.manualCode.trim().toUpperCase() : '';

    const now = new Date();
    let driver: DriverRecord | null = null;
    let method: 'qr' | 'manual' = 'qr';
    let lookupInput = '';

    if (rawToken) {
      method = 'qr';
      lookupInput = rawToken;
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(rawToken)) {
        res.status(400).json({ error: 'Format de jeton QR invalide.' });
        return;
      }
      const tokenEntry = store.badgeTokens[sha256(rawToken)];
      if (tokenEntry && !tokenEntry.revoque) {
        driver = store.drivers[tokenEntry.driverId] || null;
      }
    } else if (rawManual) {
      method = 'manual';
      lookupInput = rawManual;
      if (!agent) {
        res.status(401).json({
          error: 'La saisie manuelle est réservée aux agents connectés.',
        });
        return;
      }
      if (!checkRateLimit(`manual:${agent.agentId}`, 12, 5 * 60_000)) {
        res.status(429).json({
          error: 'Trop de recherches manuelles en 5 minutes. Utilisez le scan QR.',
        });
        return;
      }
      const normalized = rawManual.replace(/\s+/g, '');
      driver =
        Object.values(store.drivers).find(
          (d) =>
            d.shortCode.toUpperCase() === normalized ||
            d.badgeNumero.toUpperCase() === normalized
        ) || null;
    } else {
      res.status(400).json({ error: 'Jeton QR ou code manuel manquant.' });
      return;
    }

    if (!driver) {
      if (!checkRateLimit(`unknown:${callerKey}`, 15, 5 * 60_000)) {
        res.status(429).json({
          error: 'Trop de badges inconnus testés. Accès temporairement ralenti.',
        });
        return;
      }

      appendAuditLog({
        id: `ctl_${crypto.randomBytes(6).toString('hex')}`,
        date: now.toISOString(),
        eventType: 'CONTROLE',
        role,
        agentId: agent?.agentId || null,
        agentNom: agent?.nom || 'Scan public',
        corps: agent?.corps || 'Public',
        driverId: null,
        badgeNumero: method === 'manual' ? lookupInput : '—',
        driverName: 'Badge inconnu',
        statutCode: 'JETON_INCONNU',
        tone: 'ko',
        method,
      });

      res.json({
        role,
        statut: {
          code: 'INCONNU',
          tone: 'ko',
          titre: 'BADGE INCONNU',
          sous: 'Aucun chauffeur actif ne correspond à ce badge.',
          serverTime: now.toISOString(),
        },
        driver: null,
      });
      return;
    }

    const statut = computeDriverStatus(driver, now);
    const minimized = minimizeDriver(driver, role);

    appendAuditLog({
      id: `ctl_${crypto.randomBytes(6).toString('hex')}`,
      date: now.toISOString(),
      eventType: 'CONTROLE',
      role,
      agentId: agent?.agentId || null,
      agentNom: agent?.nom || 'Scan public',
      corps: agent?.corps || 'Public',
      driverId: driver.driverId,
      badgeNumero: driver.badgeNumero,
      driverName: role === 'public' ? driver.prenoms : `${driver.prenoms} ${driver.nom}`,
      statutCode: statut.code,
      tone: statut.tone,
      method,
    });

    res.json({
      role,
      statut,
      driver: minimized,
    });
  });

  // Control audit history (role-scoped, append-only source)
  app.get('/api/controls', requireAgent, (req: AuthedRequest, res: Response) => {
    const agent = req.agent!;
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const eventFilter = String(req.query.type ?? '').trim();
    const limit = Math.min(250, Math.max(10, Number(req.query.limit) || 100));

    let items = readAuditLogs();
    if (agent.role !== 'admin') {
      items = items.filter(
        (c) => c.eventType === 'CONTROLE' && c.agentId === agent.agentId
      );
    } else if (eventFilter === 'CONTROLE' || eventFilter === 'ADMIN_ACTION') {
      items = items.filter((c) => c.eventType === eventFilter);
    }

    if (q) {
      items = items.filter(
        (c) =>
          c.driverName.toLowerCase().includes(q) ||
          c.badgeNumero.toLowerCase().includes(q) ||
          c.agentNom.toLowerCase().includes(q) ||
          c.statutCode.toLowerCase().includes(q)
      );
    }

    res.json({ controls: items.slice(0, limit), total: items.length });
  });

  // ================= ADMIN ENDPOINTS =================
  app.get('/api/admin/audit/export', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const items = readAuditLogs();
    const escCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = [
      'Date',
      'Type',
      'Agent',
      'Corps',
      'Badge',
      'Chauffeur',
      'Méthode',
      'Verdict',
      'Détail',
    ].join(',');
    const rows = items.map((c) =>
      [
        escCsv(c.date),
        escCsv(c.eventType),
        escCsv(c.agentNom),
        escCsv(c.corps),
        escCsv(c.badgeNumero),
        escCsv(c.driverName),
        escCsv(c.method),
        escCsv(c.statutCode),
        escCsv(c.detail || ''),
      ].join(',')
    );

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: new Date().toISOString(),
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: null,
      badgeNumero: '—',
      driverName: 'Journal complet',
      statutCode: 'EXPORT_CSV',
      tone: 'ok',
      method: 'admin',
      detail: `Export de ${items.length} entrées`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-allodabou-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(`\uFEFF${header}\n${rows.join('\n')}`);
  });

  app.post('/api/admin/audit/purge', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const days = Math.max(30, Number(req.body?.retentionDays) || 90);
    const cutoff = Date.now() - days * DAY_MS;
    const all = readAuditLogs().reverse(); // chronological order
    const kept = all.filter((entry) => new Date(entry.date).getTime() >= cutoff);
    const purgedCount = all.length - kept.length;

    ensureDataDirs();
    const tmpAudit = `${AUDIT_PATH}.tmp`;
    fs.writeFileSync(
      tmpAudit,
      kept.map((x) => JSON.stringify(x)).join('\n') + (kept.length ? '\n' : ''),
      'utf-8'
    );
    fs.renameSync(tmpAudit, AUDIT_PATH);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: new Date().toISOString(),
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: null,
      badgeNumero: '—',
      driverName: 'Purge conformité',
      statutCode: 'PURGE_AUDIT',
      tone: 'ok',
      method: 'admin',
      detail: `${purgedCount} entrée(s) > ${days} jours purgée(s)`,
    });

    res.json({ purgedCount, remainingCount: kept.length });
  });

  app.get('/api/admin/drivers', requireAdmin, (req, res) => {
    const now = new Date();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const statusFilter = String(req.query.status ?? 'all').trim();

    let list: AdminDriverRecord[] = Object.values(store.drivers)
      .sort((a, b) => a.badgeNumero.localeCompare(b.badgeNumero))
      .map((d) => ({
        ...d,
        statut: computeDriverStatus(d, now),
      }));

    if (q) {
      list = list.filter(
        (d) =>
          d.nom.toLowerCase().includes(q) ||
          d.prenoms.toLowerCase().includes(q) ||
          d.badgeNumero.toLowerCase().includes(q) ||
          d.plaqueMoto.toLowerCase().includes(q) ||
          d.shortCode.toLowerCase().includes(q) ||
          d.quartier.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      list = list.filter((d) => d.statut.code === statusFilter);
    }

    res.json({ drivers: list, total: list.length });
  });

  app.post('/api/admin/drivers', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const nom = String(req.body?.nom ?? '').trim().toUpperCase();
    const prenoms = String(req.body?.prenoms ?? '').trim();
    const plaqueMoto = String(req.body?.plaqueMoto ?? '').trim().toUpperCase();
    const quartier = String(req.body?.quartier ?? '').trim();
    const telephone = String(req.body?.telephone ?? '').trim();
    const typeBadge = req.body?.typeBadge === 'permis' ? 'permis' : 'provisoire';
    const permisNumero = String(req.body?.permisNumero ?? '').trim().toUpperCase();
    const permisExpirationRaw = req.body?.permisExpiration;
    const photoDataUrl =
      typeof req.body?.photoDataUrl === 'string' ? req.body.photoDataUrl : '';

    if (!nom || !prenoms || !plaqueMoto) {
      res.status(400).json({ error: 'Nom, prénoms et plaque moto sont obligatoires.' });
      return;
    }

    const fmtErr = validatePlateAndPhone(plaqueMoto, telephone);
    if (fmtErr) {
      res.status(400).json({ error: fmtErr });
      return;
    }

    let parsedPermisExp: Date | null = null;
    if (typeBadge === 'permis') {
      if (!permisNumero || permisNumero.length < 4) {
        res.status(400).json({ error: 'Numéro de permis invalide.' });
        return;
      }
      parsedPermisExp = parseValidDate(permisExpirationRaw);
      if (!parsedPermisExp) {
        res.status(400).json({ error: 'Date de fin de validité du permis invalide.' });
        return;
      }
    }

    // Check duplicates
    const dupPlate = Object.values(store.drivers).find(
      (d) => d.plaqueMoto.replace(/\s+/g, '') === plaqueMoto.replace(/\s+/g, '')
    );
    if (dupPlate) {
      res.status(409).json({
        error: `La plaque ${plaqueMoto} est déjà enregistrée (${dupPlate.badgeNumero}).`,
      });
      return;
    }
    if (typeBadge === 'permis' && permisNumero) {
      const dupPermis = Object.values(store.drivers).find(
        (d) => d.permisNumero && d.permisNumero === permisNumero
      );
      if (dupPermis) {
        res.status(409).json({
          error: `Le permis ${permisNumero} est déjà associé au badge ${dupPermis.badgeNumero}.`,
        });
        return;
      }
    }

    const now = new Date();
    const num = store.badgeCounter++;
    const badgeNumero = `ADB-${String(num).padStart(4, '0')}`;
    const driverId = `drv_${crypto.randomBytes(6).toString('hex')}`;
    const shortCode = generateShortCode();
    const rawToken = generateQrToken();
    const tokenHash = sha256(rawToken);

    let photoURL = '';
    if (photoDataUrl) {
      try {
        photoURL = savePhotoDataUrl(driverId, photoDataUrl);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Erreur photo.',
        });
        return;
      }
    }

    const driver: DriverRecord = {
      driverId,
      badgeNumero,
      shortCode,
      nom,
      prenoms,
      photoURL,
      typeBadge,
      dateEmission: now.toISOString(),
      dateExpiration:
        typeBadge === 'provisoire'
          ? new Date(now.getTime() + 90 * DAY_MS).toISOString()
          : null,
      permisNumero,
      permisExpiration: parsedPermisExp ? parsedPermisExp.toISOString() : null,
      suspendu: false,
      plaqueMoto,
      quartier: quartier || 'Dabou Centre',
      telephone: telephone || 'Non renseigné',
      creeLe: now.toISOString(),
    };

    store.drivers[driverId] = driver;
    store.badgeTokens[tokenHash] = {
      tokenHash,
      driverId,
      revoque: false,
      creeLe: now.toISOString(),
    };
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: now.toISOString(),
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId,
      badgeNumero,
      driverName: `${prenoms} ${nom}`,
      statutCode: 'ENROLLEMENT',
      tone: 'ok',
      method: 'admin',
      detail: `Type: ${typeBadge} · Plaque: ${plaqueMoto}`,
    });

    res.status(201).json({
      driver: { ...driver, statut: computeDriverStatus(driver, now) },
      qrToken: rawToken,
    });
  });

  // Edit driver (plate, phone, neighborhood, photo, renew provisional or upgrade to permis)
  app.patch('/api/admin/drivers/:driverId', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const driver = store.drivers[req.params.driverId];
    if (!driver) {
      res.status(404).json({ error: 'Chauffeur introuvable.' });
      return;
    }

    const nom = req.body?.nom ? String(req.body.nom).trim().toUpperCase() : driver.nom;
    const prenoms = req.body?.prenoms ? String(req.body.prenoms).trim() : driver.prenoms;
    const plaqueMoto = req.body?.plaqueMoto
      ? String(req.body.plaqueMoto).trim().toUpperCase()
      : driver.plaqueMoto;
    const quartier =
      typeof req.body?.quartier === 'string' ? req.body.quartier.trim() : driver.quartier;
    const telephone =
      typeof req.body?.telephone === 'string' ? req.body.telephone.trim() : driver.telephone;

    const fmtErr = validatePlateAndPhone(
      plaqueMoto,
      telephone === 'Non renseigné' ? '' : telephone
    );
    if (fmtErr) {
      res.status(400).json({ error: fmtErr });
      return;
    }

    const dupPlate = Object.values(store.drivers).find(
      (d) =>
        d.driverId !== driver.driverId &&
        d.plaqueMoto.replace(/\s+/g, '') === plaqueMoto.replace(/\s+/g, '')
    );
    if (dupPlate) {
      res.status(409).json({
        error: `La plaque ${plaqueMoto} appartient déjà au badge ${dupPlate.badgeNumero}.`,
      });
      return;
    }

    const nextType: 'permis' | 'provisoire' =
      req.body?.typeBadge === 'permis'
        ? 'permis'
        : req.body?.typeBadge === 'provisoire'
        ? 'provisoire'
        : driver.typeBadge;

    if (nextType === 'permis') {
      const permisNum =
        typeof req.body?.permisNumero === 'string'
          ? req.body.permisNumero.trim().toUpperCase()
          : driver.permisNumero;
      const permisExp = req.body?.permisExpiration
        ? parseValidDate(req.body.permisExpiration)
        : driver.permisExpiration
        ? new Date(driver.permisExpiration)
        : null;
      if (!permisNum || permisNum.length < 4 || !permisExp || Number.isNaN(permisExp.getTime())) {
        res.status(400).json({
          error: 'Numéro de permis et date de fin de validité valides requis.',
        });
        return;
      }
      const dupPermis = Object.values(store.drivers).find(
        (d) => d.driverId !== driver.driverId && d.permisNumero === permisNum
      );
      if (dupPermis) {
        res.status(409).json({
          error: `Le permis ${permisNum} est déjà attribué au badge ${dupPermis.badgeNumero}.`,
        });
        return;
      }
      driver.typeBadge = 'permis';
      driver.permisNumero = permisNum;
      driver.permisExpiration = permisExp.toISOString();
      driver.dateExpiration = null;
    } else if (req.body?.renewProvisoire === true) {
      driver.typeBadge = 'provisoire';
      driver.dateExpiration = new Date(Date.now() + 90 * DAY_MS).toISOString();
    }

    if (typeof req.body?.photoDataUrl === 'string' && req.body.photoDataUrl.length > 0) {
      try {
        driver.photoURL = savePhotoDataUrl(driver.driverId, req.body.photoDataUrl);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Erreur photo.' });
        return;
      }
    }

    driver.nom = nom;
    driver.prenoms = prenoms;
    driver.plaqueMoto = plaqueMoto;
    driver.quartier = quartier || 'Dabou Centre';
    driver.telephone = telephone || 'Non renseigné';
    driver.modifieLe = new Date().toISOString();
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: driver.modifieLe,
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: driver.driverId,
      badgeNumero: driver.badgeNumero,
      driverName: `${driver.prenoms} ${driver.nom}`,
      statutCode: 'MODIFICATION_CHAUFFEUR',
      tone: 'ok',
      method: 'admin',
      detail: `Type: ${driver.typeBadge} · Plaque: ${driver.plaqueMoto}`,
    });

    res.json({
      driver: { ...driver, statut: computeDriverStatus(driver, new Date()) },
    });
  });

  app.post('/api/admin/drivers/:driverId/suspend', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const driver = store.drivers[req.params.driverId];
    if (!driver) {
      res.status(404).json({ error: 'Chauffeur introuvable.' });
      return;
    }
    const nextSuspended =
      typeof req.body?.suspendu === 'boolean' ? req.body.suspendu : !driver.suspendu;
    const motif = String(req.body?.motif ?? '').trim();
    if (nextSuspended && motif.length < 4) {
      res.status(400).json({ error: 'Motif de suspension obligatoire (4 caractères min.).' });
      return;
    }
    driver.suspendu = nextSuspended;
    driver.motifSuspension = nextSuspended ? motif : undefined;
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: new Date().toISOString(),
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: driver.driverId,
      badgeNumero: driver.badgeNumero,
      driverName: `${driver.prenoms} ${driver.nom}`,
      statutCode: nextSuspended ? 'SUSPENSION' : 'REACTIVATION',
      tone: nextSuspended ? 'ko' : 'ok',
      method: 'admin',
      detail: nextSuspended ? motif : 'Badge réactivé',
    });

    res.json({
      driver: { ...driver, statut: computeDriverStatus(driver, new Date()) },
    });
  });

  app.post('/api/admin/drivers/:driverId/reissue', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const driver = store.drivers[req.params.driverId];
    if (!driver) {
      res.status(404).json({ error: 'Chauffeur introuvable.' });
      return;
    }
    const nowIso = new Date().toISOString();
    for (const tok of Object.values(store.badgeTokens)) {
      if (tok.driverId === driver.driverId && !tok.revoque) {
        tok.revoque = true;
        tok.revoqueLe = nowIso;
      }
    }
    const newToken = generateQrToken();
    const newHash = sha256(newToken);
    store.badgeTokens[newHash] = {
      tokenHash: newHash,
      driverId: driver.driverId,
      revoque: false,
      creeLe: nowIso,
    };
    driver.shortCode = generateShortCode();
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: nowIso,
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: driver.driverId,
      badgeNumero: driver.badgeNumero,
      driverName: `${driver.prenoms} ${driver.nom}`,
      statutCode: 'REEMISSION_QR',
      tone: 'warn',
      method: 'admin',
      detail: 'Ancien jeton révoqué, nouveau QR généré',
    });

    res.json({
      driver: { ...driver, statut: computeDriverStatus(driver, new Date()) },
      qrToken: newToken,
    });
  });

  app.get('/api/admin/agents', requireAdmin, (_req, res) => {
    const agents = Object.values(store.agents).sort((a, b) =>
      a.nom.localeCompare(b.nom)
    );
    res.json({ agents });
  });

  app.post('/api/admin/agents', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const nom = String(req.body?.nom ?? '').trim();
    const corps = String(req.body?.corps ?? '').trim();
    const matricule = String(req.body?.matricule ?? '').trim().toUpperCase();
    const role = req.body?.role === 'admin' ? 'admin' : 'agent';

    if (!nom || !corps || !matricule) {
      res.status(400).json({ error: 'Nom, corps et matricule sont obligatoires.' });
      return;
    }

    const dupMatricule = Object.values(store.agents).find(
      (a) => a.matricule === matricule
    );
    if (dupMatricule) {
      res.status(409).json({ error: `Le matricule ${matricule} existe déjà.` });
      return;
    }

    const prefix = corps.toLowerCase().includes('gendarmerie')
      ? 'GEN'
      : role === 'admin'
      ? 'ADM'
      : 'POL';
    const rawCode = generateAgentCode(prefix);
    const codeHint = `${prefix}-****-****-${rawCode.slice(-4)}`;
    const agentId = `agt_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const agent: AgentRecord = {
      agentId,
      nom,
      corps,
      matricule,
      role,
      actif: true,
      codeHint,
      creeLe: nowIso,
    };
    const codeHash = hmacAgentCode(rawCode);
    store.agents[agentId] = agent;
    store.agentCodes[codeHash] = {
      codeHash,
      agentId,
      actif: true,
      expireLe: null,
    };
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: nowIso,
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: null,
      badgeNumero: matricule,
      driverName: nom,
      statutCode: 'CREATION_AGENT',
      tone: 'ok',
      method: 'admin',
      detail: `Rôle: ${role} · Corps: ${corps}`,
    });

    res.status(201).json({ agent, rawCode });
  });

  app.patch('/api/admin/agents/:agentId', requireAdmin, (req: AuthedRequest, res: Response) => {
    const admin = req.agent!;
    const target = store.agents[req.params.agentId];
    if (!target) {
      res.status(404).json({ error: 'Agent introuvable.' });
      return;
    }
    if (admin.agentId === target.agentId && req.body?.actif === false) {
      res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte actif.' });
      return;
    }
    const nextActif = typeof req.body?.actif === 'boolean' ? req.body.actif : !target.actif;
    target.actif = nextActif;
    for (const c of Object.values(store.agentCodes)) {
      if (c.agentId === target.agentId) {
        c.actif = nextActif;
      }
    }
    // Revoke any active sessions if agent is disabled
    if (!nextActif) {
      for (const [jti, sess] of Object.entries(store.activeSessions)) {
        if (sess.agentId === target.agentId) {
          delete store.activeSessions[jti];
        }
      }
    }
    saveStore(store);

    appendAuditLog({
      id: `adm_${crypto.randomBytes(6).toString('hex')}`,
      date: new Date().toISOString(),
      eventType: 'ADMIN_ACTION',
      role: 'admin',
      agentId: admin.agentId,
      agentNom: admin.nom,
      corps: admin.corps,
      driverId: null,
      badgeNumero: target.matricule,
      driverName: target.nom,
      statutCode: nextActif ? 'REACTIVATION_AGENT' : 'REVOCATION_AGENT',
      tone: nextActif ? 'ok' : 'ko',
      method: 'admin',
      detail: `${target.corps}`,
    });

    res.json({ agent: target });
  });

  const httpServer = http.createServer(app);

  // Mount Vite in dev or serve dist in production
  if (!IS_PROD) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(
          [
            'export const createHotContext = () => ({ accept(){}, dispose(){}, prune(){}, invalidate(){}, decline(){}, on(){}, off(){}, send(){}, data: {} });',
            'export const updateStyle = (id, content) => {',
            '  let s = document.querySelector(`style[data-vite-dev-id="${CSS.escape(id)}"]`);',
            '  if (!s) { s = document.createElement("style"); s.setAttribute("data-vite-dev-id", id); document.head.appendChild(s); }',
            '  s.textContent = content;',
            '};',
            'export const removeStyle = (id) => { document.querySelector(`style[data-vite-dev-id="${CSS.escape(id)}"]`)?.remove(); };',
            'export const injectQuery = (url) => url;',
            'export class ErrorOverlay {}',
          ].join('\n')
        );
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Allô Dabou · Contrôle server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
