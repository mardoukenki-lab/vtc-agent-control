import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Ban,
  CheckCircle2,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AdminAgentRecord, AdminDriverRecord, ControlLogEntry } from '../types';

interface AdminConsoleProps {
  authToken: string;
  onControlsUpdated: () => void;
}

type AdminSection = 'drivers' | 'agents' | 'audit';

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  authToken,
  onControlsUpdated,
}) => {
  const [section, setSection] = useState<AdminSection>('drivers');
  const [drivers, setDrivers] = useState<AdminDriverRecord[]>([]);
  const [agents, setAgents] = useState<AdminAgentRecord[]>([]);
  const [controls, setControls] = useState<ControlLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Issued QR Modal
  const [issuedModal, setIssuedModal] = useState<{
    badgeNumero: string;
    driverName: string;
    shortCode: string;
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [drvRes, agtRes, ctlRes] = await Promise.all([
        api.adminGetDrivers(authToken),
        api.adminGetAgents(authToken),
        api.getControls(authToken),
      ]);
      setDrivers(drvRes.drivers);
      setAgents(agtRes.agents);
      setControls(ctlRes.controls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openIssuedQr = async (driver: AdminDriverRecord, qrToken: string) => {
    const payload = `${window.location.origin}/#t=${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
    });
    setIssuedModal({
      badgeNumero: driver.badgeNumero,
      driverName: `${driver.prenoms} ${driver.nom}`,
      shortCode: driver.shortCode,
      qrToken,
      qrDataUrl,
    });
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      await loadAll();
      await openIssuedQr(res.driver, res.qrToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    }
  };

  const handleToggleSuspend = async (d: AdminDriverRecord) => {
    setError(null);
    try {
      await api.adminToggleSuspend(
        d.driverId,
        !d.suspendu,
        !d.suspendu ? 'Suspension administrative depuis console.' : '',
        authToken
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action impossible.');
    }
  };

  const handleReissue = async (d: AdminDriverRecord) => {
    setError(null);
    try {
      const res = await api.adminReissueBadge(d.driverId, authToken);
      await loadAll();
      await openIssuedQr(res.driver, res.qrToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réémission impossible.');
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
      setError(err instanceof Error ? err.message : 'Création agent impossible.');
    }
  };

  const handleToggleAgent = async (agt: AdminAgentRecord) => {
    setError(null);
    try {
      await api.adminToggleAgent(agt.agentId, !agt.actif, authToken);
      await loadAll();
      onControlsUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Modification impossible.');
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

      {/* DRIVERS TAB */}
      {section === 'drivers' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Registre des chauffeurs & badges
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enrôlement sécurisé, suspension immédiate et réémission de jeton QR
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

          {showDriverForm && (
            <form
              onSubmit={handleCreateDriver}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3"
            >
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
                  placeholder="Téléphone (+225 ...)"
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

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {drivers.map((d) => (
              <div
                key={d.driverId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
              >
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
                  <div className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5">
                    {d.prenoms} {d.nom} — <span className="font-mono">{d.plaqueMoto}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {d.quartier} · {d.telephone}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
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
                Un code nominatif par agent (haché SHA-256), révocation immédiate en cas de perte
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
                <div className="mt-1 font-mono text-lg font-bold tracking-wider text-slate-900 dark:text-white">
                  {createdAgentCode.rawCode}
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
          <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white mb-1">
            Journal d'audit serveur
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Traçabilité horodatée par serveur (y compris tentatives sur jeton inconnu)
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Heure</th>
                  <th className="py-2 pr-3 font-semibold">Agent / Corps</th>
                  <th className="py-2 pr-3 font-semibold">Badge</th>
                  <th className="py-2 pr-3 font-semibold">Méthode</th>
                  <th className="py-2 font-semibold">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {controls.map((c) => (
                  <tr key={c.id} className="text-slate-800 dark:text-slate-200">
                    <td className="py-2.5 pr-3 font-mono tabular-nums whitespace-nowrap">
                      {new Date(c.date).toLocaleTimeString('fr-FR', {
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
                    <td className="py-2.5 pr-3 font-mono whitespace-nowrap">
                      {c.badgeNumero}
                    </td>
                    <td className="py-2.5 pr-3 uppercase font-mono text-[11px] text-slate-500">
                      {c.method}
                    </td>
                    <td className="py-2.5 font-bold whitespace-nowrap">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issued QR Badge Modal */}
      {issuedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl text-center">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs font-bold text-amber-500">
                {issuedModal.badgeNumero}
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
            <h4 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {issuedModal.driverName}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Code manuel de secours :{' '}
              <strong className="font-mono text-slate-900 dark:text-white">
                {issuedModal.shortCode}
              </strong>
            </p>
            <div className="my-4 inline-block rounded-xl bg-white p-3 border border-slate-200">
              <img
                src={issuedModal.qrDataUrl}
                alt={`QR ${issuedModal.badgeNumero}`}
                className="h-52 w-52 object-contain"
              />
            </div>
            <a
              href={issuedModal.qrDataUrl}
              download={`badge-${issuedModal.badgeNumero}.png`}
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-bold text-slate-950 hover:bg-amber-300"
            >
              <Download className="h-4 w-4" />
              <span>Télécharger le QR badge (PNG)</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
