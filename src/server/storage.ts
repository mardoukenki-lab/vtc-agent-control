import { getStore } from '@netlify/blobs';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ControlLogEntry } from '../types.ts';

export interface DriverRecord {
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

export interface BadgeTokenRecord {
  tokenHash: string;
  driverId: string;
  revoque: boolean;
  creeLe: string;
  revoqueLe?: string;
}

export interface AgentRecord {
  agentId: string;
  nom: string;
  corps: string;
  matricule: string;
  role: 'agent' | 'admin';
  actif: boolean;
  codeHint: string;
  creeLe: string;
}

export interface AgentCodeRecord {
  codeHash: string;
  agentId: string;
  actif: boolean;
  expireLe: string | null;
}

export interface ActiveSessionRecord {
  jti: string;
  agentId: string;
  exp: number;
}

export interface StoreData {
  badgeCounter: number;
  drivers: Record<string, DriverRecord>;
  badgeTokens: Record<string, BadgeTokenRecord>;
  agents: Record<string, AgentRecord>;
  agentCodes: Record<string, AgentCodeRecord>;
  activeSessions: Record<string, ActiveSessionRecord>;
}

export interface ServerSecrets {
  sessionSecret: string;
  codeHmacSecret: string;
}

export interface StorageAdapter {
  loadStore: () => Promise<StoreData>;
  saveStore: (data: StoreData) => Promise<void>;
  readAuditLogs: () => Promise<ControlLogEntry[]>;
  appendAuditLog: (entry: ControlLogEntry) => Promise<void>;
  replaceAuditLogs: (entriesChronological: ControlLogEntry[]) => Promise<void>;
  savePhoto: (fileName: string, buffer: Buffer, contentType: string) => Promise<void>;
  readPhoto: (fileName: string) => Promise<{ buffer: Buffer; contentType: string } | null>;
  getSecrets: () => Promise<ServerSecrets>;
}

export function createEmptyStore(): StoreData {
  return {
    badgeCounter: 1,
    drivers: {},
    badgeTokens: {},
    agents: {},
    agentCodes: {},
    activeSessions: {},
  };
}

function normalizeStore(parsed: Partial<StoreData> | null | undefined): StoreData | null {
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
  return null;
}

export function inferImageMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// ============================================================
// 1. Local Filesystem Storage Adapter (Node VPS / AI Studio)
// ============================================================
export function createFsStorage(): StorageAdapter {
  const IS_PROD = process.env.NODE_ENV === 'production';

  const resolveDataDir = (): string => {
    const candidates = [
      process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : null,
      path.resolve(process.cwd(), 'data'),
    ].filter((v): v is string => Boolean(v));

    for (const dir of candidates) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return dir;
      } catch (err) {
        console.warn(`Répertoire de données inaccessible (${dir}):`, err);
      }
    }

    const fallback = path.join(os.tmpdir(), 'allodabou-data');
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  };

  const DATA_DIR = resolveDataDir();
  const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
  const STORE_PATH = path.join(DATA_DIR, 'store.json');
  const AUDIT_PATH = path.join(DATA_DIR, 'audit.ndjson');
  const SESSION_SECRET_PATH = path.join(DATA_DIR, '.session-secret');
  const CODE_HMAC_SECRET_PATH = path.join(DATA_DIR, '.code-secret');

  const ensureDirs = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  };

  const resolvePersistedSecret = (
    envName: 'SESSION_SECRET' | 'CODE_HMAC_SECRET',
    filePath: string
  ): string => {
    const envVal = process.env[envName]?.trim() || '';
    if (envVal.length >= 32) return envVal;

    if (IS_PROD) {
      console.warn(
        `AVERTISSEMENT: ${envName} absent ou < 32 caractères. Secret persisté dans ${filePath}.`
      );
    }

    try {
      ensureDirs();
      if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf-8').trim();
        if (existing.length >= 32) return existing;
      }
      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(filePath, generated, { mode: 0o600 });
      return generated;
    } catch {
      return crypto.randomBytes(32).toString('hex');
    }
  };

  let cachedSecrets: ServerSecrets | null = null;

  return {
    async getSecrets() {
      if (cachedSecrets) return cachedSecrets;
      cachedSecrets = {
        sessionSecret: resolvePersistedSecret('SESSION_SECRET', SESSION_SECRET_PATH),
        codeHmacSecret: resolvePersistedSecret('CODE_HMAC_SECRET', CODE_HMAC_SECRET_PATH),
      };
      return cachedSecrets;
    },

    async loadStore() {
      ensureDirs();
      try {
        if (fs.existsSync(STORE_PATH)) {
          const raw = fs.readFileSync(STORE_PATH, 'utf-8');
          const normalized = normalizeStore(JSON.parse(raw) as Partial<StoreData>);
          if (normalized) return normalized;
        }
      } catch (err) {
        console.warn('Store load fallback:', err);
      }
      const initial = createEmptyStore();
      await this.saveStore(initial);
      return initial;
    },

    async saveStore(data: StoreData) {
      ensureDirs();
      const tmpPath = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, STORE_PATH);
    },

    async readAuditLogs() {
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
    },

    async appendAuditLog(entry: ControlLogEntry) {
      ensureDirs();
      fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`, 'utf-8');
    },

    async replaceAuditLogs(entriesChronological: ControlLogEntry[]) {
      ensureDirs();
      const tmpAudit = `${AUDIT_PATH}.tmp`;
      fs.writeFileSync(
        tmpAudit,
        entriesChronological.map((x) => JSON.stringify(x)).join('\n') +
          (entriesChronological.length ? '\n' : ''),
        'utf-8'
      );
      fs.renameSync(tmpAudit, AUDIT_PATH);
    },

    async savePhoto(fileName: string, buffer: Buffer) {
      ensureDirs();
      fs.writeFileSync(path.join(PHOTOS_DIR, fileName), buffer);
    },

    async readPhoto(fileName: string) {
      const fullPath = path.join(PHOTOS_DIR, fileName);
      if (!fs.existsSync(fullPath)) return null;
      return {
        buffer: fs.readFileSync(fullPath),
        contentType: inferImageMimeType(fileName),
      };
    },
  };
}

// ============================================================
// 2. Netlify Blobs Storage Adapter (Serverless Functions)
// ============================================================
export function createNetlifyBlobsStorage(storeName = 'allodabou-controle'): StorageAdapter {
  const getBlobStore = () => getStore(storeName);

  const resolveBlobSecret = async (
    envName: 'SESSION_SECRET' | 'CODE_HMAC_SECRET',
    blobKey: string
  ): Promise<string> => {
    const envVal = process.env[envName]?.trim() || '';
    if (envVal.length >= 32) return envVal;

    console.warn(
      `AVERTISSEMENT Netlify: ${envName} absent ou < 32 caractères. Secret persisté dans Netlify Blobs (${blobKey}).`
    );
    const blobs = getBlobStore();
    const existing = await blobs.get(blobKey, { type: 'text', consistency: 'strong' });
    if (existing && existing.trim().length >= 32) {
      return existing.trim();
    }
    const generated = crypto.randomBytes(32).toString('hex');
    await blobs.set(blobKey, generated);
    return generated;
  };

  return {
    async getSecrets() {
      const [sessionSecret, codeHmacSecret] = await Promise.all([
        resolveBlobSecret('SESSION_SECRET', '_secrets/session'),
        resolveBlobSecret('CODE_HMAC_SECRET', '_secrets/code'),
      ]);
      return { sessionSecret, codeHmacSecret };
    },

    async loadStore() {
      const blobs = getBlobStore();
      const raw = (await blobs.get('store.json', {
        type: 'json',
        consistency: 'strong',
      })) as Partial<StoreData> | null;
      const normalized = normalizeStore(raw);
      if (normalized) return normalized;
      const initial = createEmptyStore();
      await blobs.setJSON('store.json', initial);
      return initial;
    },

    async saveStore(data: StoreData) {
      const blobs = getBlobStore();
      await blobs.setJSON('store.json', data);
    },

    async readAuditLogs() {
      const blobs = getBlobStore();
      const raw = (await blobs.get('audit.json', {
        type: 'json',
        consistency: 'strong',
      })) as ControlLogEntry[] | null;
      if (!Array.isArray(raw)) return [];
      return [...raw].reverse();
    },

    async appendAuditLog(entry: ControlLogEntry) {
      const blobs = getBlobStore();
      const existing = (await blobs.get('audit.json', {
        type: 'json',
        consistency: 'strong',
      })) as ControlLogEntry[] | null;
      const next = Array.isArray(existing) ? [...existing, entry] : [entry];
      await blobs.setJSON('audit.json', next);
    },

    async replaceAuditLogs(entriesChronological: ControlLogEntry[]) {
      const blobs = getBlobStore();
      await blobs.setJSON('audit.json', entriesChronological);
    },

    async savePhoto(fileName: string, buffer: Buffer, contentType: string) {
      const blobs = getBlobStore();
      const arrayBuf = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;
      await blobs.set(`photos/${fileName}`, arrayBuf, {
        metadata: { contentType },
      });
    },

    async readPhoto(fileName: string) {
      const blobs = getBlobStore();
      const res = await blobs.getWithMetadata(`photos/${fileName}`, {
        type: 'arrayBuffer',
        consistency: 'strong',
      });
      if (!res || !res.data) return null;
      const contentType =
        typeof res.metadata?.contentType === 'string'
          ? res.metadata.contentType
          : inferImageMimeType(fileName);
      return {
        buffer: Buffer.from(res.data),
        contentType,
      };
    },
  };
}
