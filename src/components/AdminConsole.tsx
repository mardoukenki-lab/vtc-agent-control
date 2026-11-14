import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Ban,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  FileDown,
  KeyRound,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { api, UnauthorizedError } from '../lib/api';
import type { AdminAgentRecord, AdminDriverRecord, ControlLogEntry } from '../types';

interface AdminConsoleProps {
  authToken: string;
  onControlsUpdated: () => void;
  onSessionExpired: () => void;
}

type AdminSection = 'drivers' | 'agents' | 'audit';

async function compressPhotoFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxW = 280;
  const maxH = 340;
  const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement image indisponible.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  authToken,
  onControlsUpdated,
  onSessionExpired,
}) => {
  const [section, setSection] = useState<AdminSection>('drivers');
  const [drivers, setDrivers] = useState<AdminDriverRecord[]>([]);
  const [agents, setAgents] = useState<AdminAgentRecord[]>([]);
  const [controls, setControls] = useState<ControlLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Driver filters
  const [driverQuery, setDriverQuery] = useState('');
  const [driverStatus, setDriverStatus] = useState('all');

  // Audit filters
  const [auditQuery, setAuditQuery] = useState('');
  const [auditType, setAuditType] = useState<'all' | 'CONTROLE' | 'ADMIN_ACTION'>('all');

  // New Driver Form
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [dNom, setDNom] = useState('');
  const [dPrenoms, setDPrenoms] = useState('');
  const [dPlaque, setDPlaque] = useState('');
  const [dQuartier, setDQuartier] = useState('');
  const [dTel, setDTel] = useState('');
  const [dType, setDType] = useState<'provisoire' | 'permis'>('provisoire');
  const [dPermisNum, setDPermisNum] = useState('');
  const [dPermisExp, setDPermisExp] = useState('');
  const [dPhotoDataUrl, setDPhotoDataUrl] = useState('');

  // Edit Driver Modal
  const [editingDriver, setEditingDriver] = useState<AdminDriverRecord | null>(null);
  const [eNom, setENom] = useState('');
  const [ePrenoms, setEPrenoms] = useState('');
  const [ePlaque, setEPlaque] = useState('');
  const [eQuartier, setEQuartier] = useState('');
  const [eTel, setETel] = useState('');
  const [eType, setEType] = useState<'provisoire' | 'permis'>('provisoire');
  const [ePermisNum, setEPermisNum] = useState('');
  const [ePermisExp, setEPermisExp] = useState('');
  const [eRenewProv, setERenewProv] = useState(false);
  const [ePhotoDataUrl, setEPhotoDataUrl] = useState('');

  // Suspension Motif Modal
  const [suspendTarget, setSuspendTarget] = useState<AdminDriverRecord | null>(null);
  const [suspendMotif, setSuspendMotif] = useState('');

  // Issued Printable Badge Modal
  const [issuedModal, setIssuedModal] = useState<{
    driver: AdminDriverRecord;
    qrToken: string;
    qrDataUrl: string;
  } | null>(null);

  // New Agent Form
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [aNom, setANom] = useState('');
  const [aCorps, setACorps] = useState('Police Nationale');
  const [aMatricule, setAMatricule] = useState('');
  const [aRole, setARole] = useState<'agent' | 'admin'>('agent');
  const [createdAgentCode, setCreatedAgentCode] = useState<{
    nom: string;
    rawCode: string;
  } | null>(null);

  const handleApiError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : fallback);
    },
    [onSessionExpired]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [drvRes, agtRes, ctlRes] = await Promise.all([
        api.adminGetDrivers(authToken, { q: driverQuery, status: driverStatus }),
        api.adminGetAgents(authToken),
        api.getControls(authToken, {
          q: auditQuery,
          type: auditType === 'all' ? undefined : auditType,
        }),
      ]);
      setDrivers(drvRes.drivers);
      setAgents(agtRes.agents);
      setControls(ctlRes.controls);
    } catch (err) {
      handleApiError(err, 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [authToken, driverQuery, driverStatus, auditQuery, auditType, handleApiError]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openIssuedBadge = async (driver: AdminDriverRecord, qrToken: string) => {
    const payload = `${window.location.origin}/#t=${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0B1120', light: '#FFFFFF' },
    });
    setIssuedModal({ driver, qrToken, qrDataUrl });
  };

  const handleNewPhotoChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressPhotoFile(file);
      setter(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo invalide.');
    }
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await api.adminCreateDriver(
        {
          nom: dNom,
          prenoms: dPrenoms,
          plaqueMoto: dPlaque,
          quartier: dQuartier,
          telephone: dTel,
          typeBadge: dType,
          permisNumero: dType === 'permis' ? dPermisNum : undefined,
          permisExpiration: dType === 'permis' ? dPermisExp : undefined,
          photoDataUrl: dPhotoDataUrl || undefined,
        },
        authToken
      );
      setShowDriverForm(false);
      setDNom('');
      setDPrenoms('');
      setDPlaque('');
      setDQuartier('');
      setDTel('');
      setDPermisNum('');
      setDPermisExp('');
      setDPhotoDataUrl('');
      await loadAll();
      await openIssuedBadge(res.driver, res.qrToken);
    } catch (err) {
      handleApiError(err, 'Erreur lors de la création.');
    }
  };

  const openEditDriver = (d: AdminDriverRecord) => {
    setEditingDriver(d);
    setENom(d.nom);
    setEPrenoms(d.prenoms);
    setEPlaque(d.plaqueMoto);
    setEQuartier(d.quartier);
    setETel(d.telephone === 'Non renseigné' ? '' : d.telephone);
    setEType(d.typeBadge);
    setEPermisNum(d.permisNumero || '');
    setEPermisExp(d.permisExpiration ? d.permisExpiration.slice(0, 10) : '');
    setERenewProv(false);
    setEPhotoDataUrl('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDriver) return;
    setError(null);
    try {
      await api.adminUpdateDriver(
        editingDriver.driverId,
        {
          nom: eNom,
          prenoms: ePrenoms,
          plaqueMoto: ePlaque,
          quartier: eQuartier,
          telephone: eTel,
          typeBadge: eType,
          permisNumero: eType === 'permis' ? ePermisNum : undefined,
          permisExpiration: eType === 'permis' ? ePermisExp : undefined,
          renewProvisoire: eType === 'provisoire' ? eRenewProv : false,
          photoDataUrl: ePhotoDataUrl || undefined,
        },
        authToken
      );
      setEditingDriver(null);
      setNotice(`Fiche ${editingDriver.badgeNumero} mise à jour.`);
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Mise à jour impossible.');
    }
  };

  const handleToggleSuspend = async (d: AdminDriverRecord) => {
    setError(null);
    if (!d.suspendu) {
      setSuspendTarget(d);
      setSuspendMotif('');
      return;
    }
    try {
      await api.adminToggleSuspend(d.driverId, false, '', authToken);
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Action impossible.');
    }
  };

  const confirmSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget) return;
    setError(null);
    try {
      await api.adminToggleSuspend(suspendTarget.driverId, true, suspendMotif, authToken);
      setSuspendTarget(null);
      setSuspendMotif('');
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Suspension impossible.');
    }
  };

  const handleReissue = async (d: AdminDriverRecord) => {
    setError(null);
    try {
      const res = await api.adminReissueBadge(d.driverId, authToken);
      await loadAll();
      await openIssuedBadge(res.driver, res.qrToken);
    } catch (err) {
      handleApiError(err, 'Réémission impossible.');
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.adminCreateAgent(
        { nom: aNom, corps: aCorps, matricule: aMatricule, role: aRole },
        authToken
      );
      setCreatedAgentCode({ nom: res.agent.nom, rawCode: res.rawCode });
      setShowAgentForm(false);
      setANom('');
      setAMatricule('');
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Création agent impossible.');
    }
  };

  const handleToggleAgent = async (agt: AdminAgentRecord) => {
    setError(null);
    try {
      await api.adminToggleAgent(agt.agentId, !agt.actif, authToken);
      await loadAll();
      onControlsUpdated();
    } catch (err) {
      handleApiError(err, 'Modification impossible.');
    }
  };

  const handleExportCsv = async () => {
    setError(null);
    try {
      const blob = await api.adminExportAuditCsv(authToken);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-allodabou-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Export impossible.');
    }
  };

  const handlePurgeAudit = async (days: number) => {
    setError(null);
    try {
      const res = await api.adminPurgeAudit(days, authToken);
      setNotice(`${res.purgedCount} entrée(s) antérieure(s) à ${days} jours purgée(s).`);
      await loadAll();
    } catch (err) {
      handleApiError(err, 'Purge impossible.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented Section Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => setSection('drivers')}
            className={`min-h-[40px] rounded-lg px-3.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'drivers'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Chauffeurs ({drivers.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('agents')}
            className={`min-h-[40px] rounded-lg px-3.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'agents'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Agents ({agents.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('audit')}
            className={`min-h-[40px] rounded-lg px-3.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'audit'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Journal ({controls.length})
          </button>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs font-semibold text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="p-1 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* DRIVERS TAB */}
      {section === 'drivers' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Registre des chauffeurs & badges
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enrôlement sécurisé, édition, suspension motivée et réémission de jeton QR
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDriverForm((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-amber-400 px-4 text-xs font-bold text-slate-950 hover:bg-amber-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Enrôler</span>
            </button>
          </div>

          {/* Search & Status Filter */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={driverQuery}
                onChange={(e) => setDriverQuery(e.target.value)}
                placeholder="Rechercher nom, badge, plaque, quartier…"
                className="min-h-[42px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <select
              value={driverStatus}
              onChange={(e) => setDriverStatus(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <option value="all">Tous statuts</option>
              <option value="VALIDE">Valide</option>
              <option value="PROVISOIRE">Provisoire</option>
              <option value="EXPIRE">Expiré</option>
              <option value="PERMIS_EXPIRE">Permis expiré</option>
              <option value="SUSPENDU">Suspendu</option>
            </select>
          </div>

          {showDriverForm && (
            <form
              onSubmit={handleCreateDriver}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3"
            >
              <div className="flex items-center gap-3">
                <label className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Camera className="h-4 w-4 text-amber-500" />
                  <span>{dPhotoDataUrl ? 'Photo prête (changer)' : 'Photo chauffeur'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleNewPhotoChange(e, setDPhotoDataUrl)}
                    className="hidden"
                  />
                </label>
                {dPhotoDataUrl && (
                  <img
                    src={dPhotoDataUrl}
                    alt="Aperçu photo"
                    className="h-12 w-10 rounded-lg object-cover border border-slate-300 dark:border-slate-700"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  value={dPrenoms}
                  onChange={(e) => setDPrenoms(e.target.value)}
                  placeholder="Prénoms *"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                />
                <input
                  required
                  value={dNom}
                  onChange={(e) => setDNom(e.target.value)}
                  placeholder="Nom *"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                />
                <input
                  required
                  value={dPlaque}
                  onChange={(e) => setDPlaque(e.target.value)}
                  placeholder="Plaque moto (ex: 4412 AB 01) *"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm text-slate-900 dark:text-white"
                />
                <input
                  value={dQuartier}
                  onChange={(e) => setDQuartier(e.target.value)}
                  placeholder="Quartier (ex: Dabou Centre)"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                />
                <input
                  value={dTel}
                  onChange={(e) => setDTel(e.target.value)}
                  placeholder="Téléphone (+225 07 ...)"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm text-slate-900 dark:text-white"
                />
                <select
                  value={dType}
                  onChange={(e) => setDType(e.target.value as 'provisoire' | 'permis')}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm font-medium text-slate-900 dark:text-white"
                >
                  <option value="provisoire">Badge Provisoire (3 mois)</option>
                  <option value="permis">Titulaire d'un Permis</option>
                </select>
              </div>

              {dType === 'permis' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    required
                    value={dPermisNum}
                    onChange={(e) => setDPermisNum(e.target.value)}
                    placeholder="N° de permis *"
                    className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm text-slate-900 dark:text-white"
                  />
                  <input
                    required
                    type="date"
                    value={dPermisExp}
                    onChange={(e) => setDPermisExp(e.target.value)}
                    className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm text-slate-900 dark:text-white"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDriverForm(false)}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-amber-400 px-5 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  Émettre le badge QR
                </button>
              </div>
            </form>
          )}

          {drivers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucun chauffeur enregistré correspondant à ces critères. Cliquez sur « Enrôler » pour délivrer le premier badge.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {drivers.map((d) => (
                <div
                  key={d.driverId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {d.photoURL ? (
                      <img
                        src={d.photoURL}
                        alt={d.prenoms}
                        className="h-12 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="flex h-12 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-400 shrink-0">
                        <User className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {d.badgeNumero}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-slate-500 dark:text-slate-400">{d.shortCode}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className={`font-bold ${
                            d.statut.tone === 'ok'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : d.statut.tone === 'warn'
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {d.statut.titre}
                        </span>
                      </div>
                      <div className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5 truncate">
                        {d.prenoms} {d.nom} — <span className="font-mono">{d.plaqueMoto}</span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {d.quartier} · {d.telephone}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditDriver(d)}
                      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>Modifier</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReissue(d)}
                      title="Révoquer l'ancien QR et générer un nouveau badge"
                      className="min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Réémettre QR
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSuspend(d)}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-xs font-bold cursor-pointer ${
                        d.suspendu
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-red-600/10 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-900 hover:bg-red-600/20'
                      }`}
                    >
                      {d.suspendu ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Réactiver</span>
                        </>
                      ) : (
                        <>
                          <Ban className="h-3.5 w-3.5" />
                          <span>Suspendre</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AGENTS TAB */}
      {section === 'agents' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Codes d'accès individuels des agents
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Codes à 12 caractères aléatoires (HMAC-SHA256), révocation immédiate des sessions
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAgentForm((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-amber-400 px-4 text-xs font-bold text-slate-950 hover:bg-amber-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              <span>Nouvel agent</span>
            </button>
          </div>

          {createdAgentCode && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  Code généré pour {createdAgentCode.nom} (affiché une seule fois)
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-base sm:text-lg font-bold tracking-wider text-slate-900 dark:text-white">
                    {createdAgentCode.rawCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(createdAgentCode.rawCode)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copier</span>
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreatedAgentCode(null)}
                aria-label="Fermer"
                className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showAgentForm && (
            <form
              onSubmit={handleCreateAgent}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  value={aNom}
                  onChange={(e) => setANom(e.target.value)}
                  placeholder="Grade et nom complet *"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                />
                <input
                  required
                  value={aMatricule}
                  onChange={(e) => setAMatricule(e.target.value)}
                  placeholder="Matricule (ex: PN-DB-509) *"
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm text-slate-900 dark:text-white"
                />
                <select
                  value={aCorps}
                  onChange={(e) => setACorps(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                >
                  <option value="Police Nationale">Police Nationale</option>
                  <option value="Gendarmerie Nationale">Gendarmerie Nationale</option>
                  <option value="Autorité Municipale">Autorité Municipale</option>
                </select>
                <select
                  value={aRole}
                  onChange={(e) => setARole(e.target.value as 'agent' | 'admin')}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white"
                >
                  <option value="agent">Rôle : Agent de contrôle</option>
                  <option value="admin">Rôle : Administrateur</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAgentForm(false)}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-amber-400 px-5 text-xs font-bold text-white dark:text-slate-950 cursor-pointer"
                >
                  Créer le code nominatif
                </button>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {agents.map((agt) => (
              <div
                key={agt.agentId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <Shield className="h-4 w-4 text-amber-500" />
                    <span>{agt.nom}</span>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {agt.matricule}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{agt.corps}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{agt.codeHint}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-bold ${
                        agt.actif
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {agt.actif ? 'Actif' : 'Révoqué'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleAgent(agt)}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold cursor-pointer shrink-0 ${
                    agt.actif
                      ? 'border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-100'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                >
                  {agt.actif ? (
                    <>
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Révoquer l'accès</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>Réactiver</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AUDIT TAB */}
      {section === 'audit' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Journal d'audit serveur (ajout seul)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Contrôles terrain, tentatives inconnues et actions d'administration
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <FileDown className="h-3.5 w-3.5 text-amber-500" />
                <span>Exporter CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handlePurgeAudit(90)}
                title="Purger les entrées de plus de 90 jours (conformité Loi n° 2013-450)"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Purger &gt; 90 j</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                placeholder="Filtrer par agent, chauffeur, badge, verdict…"
                className="min-h-[42px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <select
              value={auditType}
              onChange={(e) =>
                setAuditType(e.target.value as 'all' | 'CONTROLE' | 'ADMIN_ACTION')
              }
              className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <option value="all">Tous événements</option>
              <option value="CONTROLE">Contrôles terrain</option>
              <option value="ADMIN_ACTION">Actions admin</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Date/Heure</th>
                  <th className="py-2 pr-3 font-semibold">Agent / Corps</th>
                  <th className="py-2 pr-3 font-semibold">Cible</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 font-semibold">Verdict / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {controls.map((c) => (
                  <tr key={c.id} className="text-slate-800 dark:text-slate-200">
                    <td className="py-2.5 pr-3 font-mono tabular-nums whitespace-nowrap">
                      {new Date(c.date).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold">{c.agentNom}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {c.corps}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-mono">{c.badgeNumero}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {c.driverName}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 uppercase font-mono text-[11px] text-slate-500">
                      {c.method}
                    </td>
                    <td className="py-2.5 font-bold">
                      <span
                        className={
                          c.tone === 'ok'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : c.tone === 'warn'
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {c.statutCode}
                      </span>
                      {c.detail && (
                        <div className="font-normal text-[11px] text-slate-500 dark:text-slate-400">
                          {c.detail}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Driver Modal */}
      {editingDriver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Modifier {editingDriver.badgeNumero}
              </h4>
              <button
                type="button"
                onClick={() => setEditingDriver(null)}
                className="p-2 text-slate-500 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                <Camera className="h-4 w-4 text-amber-500" />
                <span>{ePhotoDataUrl ? 'Nouvelle photo prête' : 'Changer la photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleNewPhotoChange(e, setEPhotoDataUrl)}
                  className="hidden"
                />
              </label>
              {(ePhotoDataUrl || editingDriver.photoURL) && (
                <img
                  src={ePhotoDataUrl || editingDriver.photoURL}
                  alt={ePrenoms}
                  className="h-12 w-10 rounded-lg object-cover border border-slate-300 dark:border-slate-700"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <input
                required
                value={ePrenoms}
                onChange={(e) => setEPrenoms(e.target.value)}
                placeholder="Prénoms *"
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm text-slate-900 dark:text-white"
              />
              <input
                required
                value={eNom}
                onChange={(e) => setENom(e.target.value)}
                placeholder="Nom *"
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm text-slate-900 dark:text-white"
              />
              <input
                required
                value={ePlaque}
                onChange={(e) => setEPlaque(e.target.value)}
                placeholder="Plaque *"
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 font-mono text-sm text-slate-900 dark:text-white"
              />
              <input
                value={eQuartier}
                onChange={(e) => setEQuartier(e.target.value)}
                placeholder="Quartier"
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <input
              value={eTel}
              onChange={(e) => setETel(e.target.value)}
              placeholder="Téléphone"
              className="min-h-[42px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 font-mono text-sm text-slate-900 dark:text-white"
            />

            <select
              value={eType}
              onChange={(e) => setEType(e.target.value as 'provisoire' | 'permis')}
              className="min-h-[42px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm font-medium text-slate-900 dark:text-white"
            >
              <option value="provisoire">Badge Provisoire</option>
              <option value="permis">Titulaire d'un Permis</option>
            </select>

            {eType === 'provisoire' ? (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={eRenewProv}
                  onChange={(e) => setERenewProv(e.target.checked)}
                  className="h-4 w-4 rounded accent-amber-400"
                />
                <span>Renouveler le provisoire pour 90 jours à compter d'aujourd'hui</span>
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  required
                  value={ePermisNum}
                  onChange={(e) => setEPermisNum(e.target.value)}
                  placeholder="N° de permis *"
                  className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 font-mono text-sm text-slate-900 dark:text-white"
                />
                <input
                  required
                  type="date"
                  value={ePermisExp}
                  onChange={(e) => setEPermisExp(e.target.value)}
                  className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 font-mono text-sm text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingDriver(null)}
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-amber-400 px-5 text-xs font-bold text-slate-950 cursor-pointer"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Suspension Motif Modal */}
      {suspendTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={confirmSuspend}
            className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-3"
          >
            <h4 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Suspendre {suspendTarget.badgeNumero}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {suspendTarget.prenoms} {suspendTarget.nom} · {suspendTarget.plaqueMoto}
            </p>
            <input
              required
              minLength={4}
              value={suspendMotif}
              onChange={(e) => setSuspendMotif(e.target.value)}
              placeholder="Motif officiel de suspension (obligatoire) *"
              autoFocus
              className="min-h-[44px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-red-600 px-4 text-xs font-bold text-white cursor-pointer"
              >
                Confirmer la suspension
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable Complete Driver Badge Modal */}
      {issuedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3 print:hidden">
              <span className="font-mono text-xs font-bold text-amber-500">
                Carte badge prête à imprimer
              </span>
              <button
                type="button"
                onClick={() => setIssuedModal(null)}
                aria-label="Fermer"
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Printable Card Surface (85x54mm credit-card proportion) */}
            <div className="rounded-xl border-2 border-slate-900 bg-white p-4 text-slate-950">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-display text-lg font-extrabold tracking-tight">
                  ALLÔ DABOU · CHAUFFEUR
                </span>
                <span className="font-mono text-xs font-bold">
                  {issuedModal.driver.badgeNumero}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                {issuedModal.driver.photoURL ? (
                  <img
                    src={issuedModal.driver.photoURL}
                    alt={issuedModal.driver.prenoms}
                    className="h-24 w-20 rounded-lg object-cover border border-slate-300 shrink-0"
                  />
                ) : (
                  <div className="flex h-24 w-20 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-400 shrink-0">
                    <User className="h-8 w-8" />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <div className="font-display text-xl font-extrabold leading-tight truncate">
                    {issuedModal.driver.prenoms}
                  </div>
                  <div className="font-display text-lg font-bold leading-tight truncate">
                    {issuedModal.driver.nom}
                  </div>
                  <div className="mt-1.5 font-mono text-xs font-bold">
                    Moto : {issuedModal.driver.plaqueMoto}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-600">
                    {issuedModal.driver.typeBadge === 'permis'
                      ? 'Titulaire permis'
                      : 'Provisoire (3 mois)'}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">
                    Code manuel : {issuedModal.driver.shortCode}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
                <div className="text-[10px] text-slate-600 max-w-[140px] leading-snug">
                  Scanner le QR pour vérifier la validité en temps réel auprès des autorités.
                </div>
                <img
                  src={issuedModal.qrDataUrl}
                  alt={`QR ${issuedModal.driver.badgeNumero}`}
                  className="h-24 w-24 object-contain"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-amber-400 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Imprimer carte</span>
              </button>
              <a
                href={issuedModal.qrDataUrl}
                download={`badge-${issuedModal.driver.badgeNumero}.png`}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <Download className="h-4 w-4" />
                <span>QR PNG</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
