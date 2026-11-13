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
  TestBadgeSample,
  VerificationStatus,
} from './src/types';

dotenv.config();

const PORT = 3000;
const DAY_MS = 86_400_000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

// Ephemeral fallback secret if SESSION_SECRET is not provided in environment
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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

interface StoreData {
  badgeCounter: number;
  drivers: Record<string, DriverRecord>;
  badgeTokens: Record<string, BadgeTokenRecord>;
  agents: Record<string, AgentRecord>;
  agentCodes: Record<string, AgentCodeRecord>;
  controles: ControlLogEntry[];
  testBadges: TestBadgeSample[];
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateQrToken(): string {
  return crypto.randomBytes(16).toString('base64url'); // 22 chars cryptographic token
}

function generateShortCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 without ambiguous chars
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function generateAgentCode(prefix: string): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += alphabet[bytes[i] % alphabet.length];
    part2 += alphabet[bytes[i + 4] % alphabet.length];
  }
  return `${prefix}-${part1}-${part2}`;
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

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function createInitialStore(): StoreData {
  const nowIso = new Date().toISOString();

  // Seed 4 realistic drivers for Dabou (Côte d'Ivoire)
  const driversSeed: Array<{
    driver: DriverRecord;
    token: string;
    expectedLabel: string;
    tone: StatusTone;
  }> = [
    {
      driver: {
        driverId: 'drv_kouassi_01',
        badgeNumero: 'ADB-0001',
        shortCode: 'K9M4P2W7',
        nom: 'KOUASSI',
        prenoms: 'Jean-Marc',
        photoURL: '/avatars/driver-1.svg',
        typeBadge: 'permis',
        dateEmission: daysFromNowIso(-120),
        dateExpiration: null,
        permisNumero: 'CI-2291-04',
        permisExpiration: daysFromNowIso(620),
        suspendu: false,
        plaqueMoto: '1234 AB 01',
        quartier: 'Dabou Centre',
        telephone: '+225 07 48 12 90 01',
        creeLe: nowIso,
      },
      token: 'vK8mQ2xP9nR4tL7wZ1cB5f',
      expectedLabel: 'Permis valide',
      tone: 'ok',
    },
    {
      driver: {
        driverId: 'drv_yao_02',
        badgeNumero: 'ADB-0002',
        shortCode: 'Y7N3R8H5',
        nom: 'YAO',
        prenoms: 'Serge Olivier',
        photoURL: '/avatars/driver-2.svg',
        typeBadge: 'provisoire',
        dateEmission: daysFromNowIso(-49),
        dateExpiration: daysFromNowIso(41),
        permisNumero: '',
        permisExpiration: null,
        suspendu: false,
        plaqueMoto: '5678 CD 01',
        quartier: 'Dabou-Nord',
        telephone: '+225 05 62 33 18 02',
        creeLe: nowIso,
      },
      token: 'pW4jT6yN8bM2vX5qK9dF3s',
      expectedLabel: 'Provisoire (41 j)',
      tone: 'warn',
    },
    {
      driver: {
        driverId: 'drv_traore_03',
        badgeNumero: 'ADB-0003',
        shortCode: 'T5X8C4M2',
        nom: 'TRAORÉ',
        prenoms: 'Ibrahim',
        photoURL: '/avatars/driver-3.svg',
        typeBadge: 'provisoire',
        dateEmission: daysFromNowIso(-98),
        dateExpiration: daysFromNowIso(-8),
        permisNumero: '',
        permisExpiration: null,
        suspendu: false,
        plaqueMoto: '9012 EF 01',
        quartier: 'Gare Routière',
        telephone: '+225 01 40 77 52 03',
        creeLe: nowIso,
      },
      token: 'mZ9cR3vB7nK4pW2xL8qT6h',
      expectedLabel: 'Provisoire expiré',
      tone: 'ko',
    },
    {
      driver: {
        driverId: 'drv_gnagne_04',
        badgeNumero: 'ADB-0004',
        shortCode: 'G6P9V3L8',
        nom: 'GNAGNE',
        prenoms: 'Armand',
        photoURL: '/avatars/driver-4.svg',
        typeBadge: 'permis',
        dateEmission: daysFromNowIso(-200),
        dateExpiration: null,
        permisNumero: 'CI-8840-19',
        permisExpiration: daysFromNowIso(310),
        suspendu: true,
        motifSuspension: 'Suspension administrative : défaut de visite technique.',
        plaqueMoto: '3349 GH 01',
        quartier: 'Wrod / Carrefour',
        telephone: '+225 07 89 04 11 04',
        creeLe: nowIso,
      },
      token: 'rH2fN8qL5wX9mC3vP6tK4z',
      expectedLabel: 'Badge suspendu',
      tone: 'ko',
    },
  ];

  const drivers: Record<string, DriverRecord> = {};
  const badgeTokens: Record<string, BadgeTokenRecord> = {};
  const testBadges: TestBadgeSample[] = [];

  for (const item of driversSeed) {
    drivers[item.driver.driverId] = item.driver;
    const tokenHash = sha256(item.token);
    badgeTokens[tokenHash] = {
      tokenHash,
      driverId: item.driver.driverId,
      revoque: false,
      creeLe: nowIso,
    };
    testBadges.push({
      badgeNumero: item.driver.badgeNumero,
      shortCode: item.driver.shortCode,
      qrToken: item.token,
      driverName: `${item.driver.prenoms} ${item.driver.nom}`,
      expectedLabel: item.expectedLabel,
      tone: item.tone,
      typeBadge: item.driver.typeBadge,
    });
  }

  // Individual agent accounts & hashed access codes (never shared per corps)
  const agentsSeed: Array<{ agent: AgentRecord; rawCode: string }> = [
    {
      agent: {
        agentId: 'agt_police_01',
        nom: 'Sgt Kouamé Yao',
        corps: 'Police Nationale',
        matricule: 'PN-DB-412',
        role: 'agent',
        actif: true,
        codeHint: 'POL-****-8491',
        creeLe: nowIso,
      },
      rawCode: 'POL-2026-8491',
    },
    {
      agent: {
        agentId: 'agt_gendarmerie_01',
        nom: 'Mdl/C Bamba Sékou',
        corps: 'Gendarmerie Nationale',
        matricule: 'GN-DB-108',
        role: 'agent',
        actif: true,
        codeHint: 'GEN-****-3107',
        creeLe: nowIso,
      },
      rawCode: 'GEN-2026-3107',
    },
    {
      agent: {
        agentId: 'agt_admin_01',
        nom: 'Insp. Gnango Marc',
        corps: 'Autorité Municipale · Allô Dabou',
        matricule: 'ADM-DB-001',
        role: 'admin',
        actif: true,
        codeHint: 'ADM-****-9940',
        creeLe: nowIso,
      },
      rawCode: 'ADM-2026-9940',
    },
  ];

  const agents: Record<string, AgentRecord> = {};
  const agentCodes: Record<string, AgentCodeRecord> = {};

  for (const item of agentsSeed) {
    agents[item.agent.agentId] = item.agent;
    const codeHash = sha256(item.rawCode);
    agentCodes[codeHash] = {
      codeHash,
      agentId: item.agent.agentId,
      actif: true,
      expireLe: null,
    };
  }

  return {
    badgeCounter: 5,
    drivers,
    badgeTokens,
    agents,
    agentCodes,
    controles: [
      {
        id: 'ctl_seed_1',
        date: new Date(Date.now() - 25 * 60_000).toISOString(),
        role: 'agent',
        agentId: 'agt_police_01',
        agentNom: 'Sgt Kouamé Yao',
        corps: 'Police Nationale',
        driverId: 'drv_kouassi_01',
        badgeNumero: 'ADB-0001',
        driverName: 'Jean-Marc KOUASSI',
        statutCode: 'VALIDE',
        tone: 'ok',
        method: 'qr',
      },
      {
        id: 'ctl_seed_2',
        date: new Date(Date.now() - 12 * 60_000).toISOString(),
        role: 'agent',
        agentId: 'agt_gendarmerie_01',
        agentNom: 'Mdl/C Bamba Sékou',
        corps: 'Gendarmerie Nationale',
        driverId: 'drv_yao_02',
        badgeNumero: 'ADB-0002',
        driverName: 'Serge Olivier YAO',
        statutCode: 'PROVISOIRE',
        tone: 'warn',
        method: 'qr',
      },
    ],
    testBadges,
  };
}

function loadStore(): StoreData {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && parsed.drivers && parsed.badgeTokens && parsed.agents && parsed.agentCodes) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Store load fallback:', err);
  }
  const initial = createInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

const store: StoreData = loadStore();

// Server-side status calculation using server clock ONLY
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
    if (pe.getTime() < now.getTime()) {
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
  if (ex.getTime() < now.getTime()) {
    return {
      code: 'EXPIRE',
      tone: 'ko',
      titre: 'EXPIRÉ',
      sous: `Badge provisoire expiré le ${formatDateFr(ex)}. Permis requis.`,
      serverTime,
    };
  }

  const joursRestants = Math.max(1, Math.ceil((ex.getTime() - now.getTime()) / DAY_MS));
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

// HMAC-SHA256 stateless session token with live server active-agent verification
interface TokenPayload {
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

function verifySessionToken(token: string): AgentRecord | null {
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
    if (!payload.agentId || !payload.exp || payload.exp < Date.now()) return null;

    // Always re-verify active state on server so disabled agents lose access immediately
    const agent = store.agents[payload.agentId];
    if (!agent || !agent.actif) return null;
    return agent;
  } catch {
    return null;
  }
}

// Sliding window rate limiter
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

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

interface AuthedRequest extends Request {
  agent?: AgentRecord | null;
}

function resolveOptionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    req.agent = verifySessionToken(auth.slice(7).trim());
  } else {
    req.agent = null;
  }
  next();
}

function requireAgent(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.agent) {
    res.status(401).json({ error: 'Authentification agent requise.' });
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

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  // Security headers aligned with technical recommendations
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
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

  // Agent login via individual access code (hashed SHA-256)
  app.post('/api/auth/login', (req: AuthedRequest, res: Response) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`login:${ip}`, 10, 5 * 60_000)) {
      res.status(429).json({
        error: 'Trop de tentatives de connexion. Patientez 5 minutes avant de réessayer.',
      });
      return;
    }

    const rawCode = String(req.body?.code ?? '').trim().toUpperCase();
    if (rawCode.length < 8 || rawCode.length > 64) {
      res.status(400).json({ error: 'Code agent invalide.' });
      return;
    }

    const hash = sha256(rawCode);
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

    const expiresAtMs = Date.now() + 8 * 60 * 60_000; // 8 hours patrol shift
    const token = signSessionToken({
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

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  // Main badge verification endpoint (QR token or agent-only manual fallback)
  app.post('/api/verify', (req: AuthedRequest, res: Response) => {
    const ip = getClientIp(req);
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

      const logEntry: ControlLogEntry = {
        id: `ctl_${crypto.randomBytes(6).toString('hex')}`,
        date: now.toISOString(),
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
      };
      store.controles.unshift(logEntry);
      store.controles = store.controles.slice(0, 500);
      saveStore(store);

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

    const logEntry: ControlLogEntry = {
      id: `ctl_${crypto.randomBytes(6).toString('hex')}`,
      date: now.toISOString(),
      role,
      agentId: agent?.agentId || null,
      agentNom: agent?.nom || 'Scan public',
      corps: agent?.corps || 'Public',
      driverId: driver.driverId,
      badgeNumero: driver.badgeNumero,
      driverName:
        role === 'public' ? driver.prenoms : `${driver.prenoms} ${driver.nom}`,
      statutCode: statut.code,
      tone: statut.tone,
      method,
    };
    store.controles.unshift(logEntry);
    store.controles = store.controles.slice(0, 500);
    saveStore(store);

    res.json({
      role,
      statut,
      driver: minimized,
    });
  });

  // Control audit history (role-scoped)
  app.get('/api/controls', requireAgent, (req: AuthedRequest, res: Response) => {
    const agent = req.agent!;
    const list =
      agent.role === 'admin'
        ? store.controles.slice(0, 100)
        : store.controles.filter((c) => c.agentId === agent.agentId).slice(0, 25);
    res.json({ controls: list });
  });

  // Test badges endpoint (for field simulation & QR testing without leaking real tokens in production)
  app.get('/api/test-badges', (_req, res) => {
    res.json({ badges: store.testBadges });
  });

  // ================= ADMIN ENDPOINTS =================
  app.get('/api/admin/drivers', requireAdmin, (_req, res) => {
    const now = new Date();
    const list: AdminDriverRecord[] = Object.values(store.drivers)
      .sort((a, b) => a.badgeNumero.localeCompare(b.badgeNumero))
      .map((d) => ({
        ...d,
        statut: computeDriverStatus(d, now),
      }));
    res.json({ drivers: list });
  });

  app.post('/api/admin/drivers', requireAdmin, (req, res) => {
    const nom = String(req.body?.nom ?? '').trim().toUpperCase();
    const prenoms = String(req.body?.prenoms ?? '').trim();
    const plaqueMoto = String(req.body?.plaqueMoto ?? '').trim().toUpperCase();
    const quartier = String(req.body?.quartier ?? '').trim();
    const telephone = String(req.body?.telephone ?? '').trim();
    const typeBadge = req.body?.typeBadge === 'permis' ? 'permis' : 'provisoire';
    const permisNumero = String(req.body?.permisNumero ?? '').trim().toUpperCase();
    const permisExpiration =
      typeBadge === 'permis' ? String(req.body?.permisExpiration ?? '').trim() : null;

    if (!nom || !prenoms || !plaqueMoto) {
      res.status(400).json({ error: 'Nom, prénoms et plaque moto sont obligatoires.' });
      return;
    }
    if (typeBadge === 'permis' && (!permisNumero || !permisExpiration)) {
      res.status(400).json({
        error: 'Numéro et date de fin de validité du permis requis pour un badge Permis.',
      });
      return;
    }

    const now = new Date();
    const num = store.badgeCounter++;
    const badgeNumero = `ADB-${String(num).padStart(4, '0')}`;
    const driverId = `drv_${crypto.randomBytes(6).toString('hex')}`;
    const shortCode = generateShortCode();
    const rawToken = generateQrToken();
    const tokenHash = sha256(rawToken);
    const avatarIndex = ((num - 1) % 4) + 1;

    const driver: DriverRecord = {
      driverId,
      badgeNumero,
      shortCode,
      nom,
      prenoms,
      photoURL: `/avatars/driver-${avatarIndex}.svg`,
      typeBadge,
      dateEmission: now.toISOString(),
      dateExpiration:
        typeBadge === 'provisoire'
          ? new Date(now.getTime() + 90 * DAY_MS).toISOString()
          : null,
      permisNumero,
      permisExpiration:
        typeBadge === 'permis' && permisExpiration
          ? new Date(permisExpiration).toISOString()
          : null,
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

    res.status(201).json({
      driver: { ...driver, statut: computeDriverStatus(driver, now) },
      qrToken: rawToken,
    });
  });

  app.post('/api/admin/drivers/:driverId/suspend', requireAdmin, (req, res) => {
    const driver = store.drivers[req.params.driverId];
    if (!driver) {
      res.status(404).json({ error: 'Chauffeur introuvable.' });
      return;
    }
    const nextSuspended = typeof req.body?.suspendu === 'boolean' ? req.body.suspendu : !driver.suspendu;
    driver.suspendu = nextSuspended;
    driver.motifSuspension = nextSuspended
      ? String(req.body?.motif ?? '').trim() || 'Suspension administrative immédiate.'
      : undefined;
    saveStore(store);

    res.json({
      driver: { ...driver, statut: computeDriverStatus(driver, new Date()) },
    });
  });

  app.post('/api/admin/drivers/:driverId/reissue', requireAdmin, (req, res) => {
    const driver = store.drivers[req.params.driverId];
    if (!driver) {
      res.status(404).json({ error: 'Chauffeur introuvable.' });
      return;
    }
    const nowIso = new Date().toISOString();
    // Revoke all previous QR tokens for this driver
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

    // Keep testBadges synced if this driver is in testBadges
    const tb = store.testBadges.find((b) => b.badgeNumero === driver.badgeNumero);
    if (tb) {
      tb.qrToken = newToken;
      tb.shortCode = driver.shortCode;
    }
    saveStore(store);

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

  app.post('/api/admin/agents', requireAdmin, (req, res) => {
    const nom = String(req.body?.nom ?? '').trim();
    const corps = String(req.body?.corps ?? '').trim();
    const matricule = String(req.body?.matricule ?? '').trim().toUpperCase();
    const role = req.body?.role === 'admin' ? 'admin' : 'agent';

    if (!nom || !corps || !matricule) {
      res.status(400).json({ error: 'Nom, corps et matricule sont obligatoires.' });
      return;
    }

    const prefix = corps.toLowerCase().includes('gendarmerie')
      ? 'GEN'
      : role === 'admin'
      ? 'ADM'
      : 'POL';
    const rawCode = generateAgentCode(prefix);
    const codeHint = `${prefix}-****-${rawCode.slice(-4)}`;
    const agentId = `agt_${crypto.randomBytes(5).toString('hex')}`;
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
    const codeHash = sha256(rawCode);
    store.agents[agentId] = agent;
    store.agentCodes[codeHash] = {
      codeHash,
      agentId,
      actif: true,
      expireLe: null,
    };
    saveStore(store);

    res.status(201).json({ agent, rawCode });
  });

  app.patch('/api/admin/agents/:agentId', requireAdmin, (req: AuthedRequest, res: Response) => {
    const target = store.agents[req.params.agentId];
    if (!target) {
      res.status(404).json({ error: 'Agent introuvable.' });
      return;
    }
    if (req.agent && req.agent.agentId === target.agentId && req.body?.actif === false) {
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
    saveStore(store);
    res.json({ agent: target });
  });

  const httpServer = http.createServer(app);

  // Mount Vite in dev or serve dist in production
  if (process.env.NODE_ENV !== 'production') {
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
