import React, { useState } from 'react';
import {
  Clock,
  HelpCircle,
  Lock,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { StatusTone, VerifyResponse } from '../types';

interface VerificationResultCardProps {
  result: VerifyResponse;
  onReset: () => void;
  onRequestLogin: () => void;
}

const TONE_STYLES: Record<
  StatusTone,
  { banner: string; icon: React.ReactNode; label: string }
> = {
  ok: {
    banner: 'bg-emerald-600 text-white border-emerald-700',
    icon: <ShieldCheck className="h-9 w-9 shrink-0" />,
    label: 'Contrôle conforme',
  },
  warn: {
    banner: 'bg-orange-600 text-white border-orange-700',
    icon: <Clock className="h-9 w-9 shrink-0" />,
    label: 'Validité temporaire',
  },
  ko: {
    banner: 'bg-red-600 text-white border-red-700',
    icon: <ShieldAlert className="h-9 w-9 shrink-0" />,
    label: 'Alerte contrôle',
  },
  unk: {
    banner: 'bg-slate-600 text-white border-slate-700',
    icon: <HelpCircle className="h-9 w-9 shrink-0" />,
    label: 'Statut indéterminé',
  },
};

function formatDateFr(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatServerTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const VerificationResultCard: React.FC<VerificationResultCardProps> = ({
  result,
  onReset,
  onRequestLogin,
}) => {
  const [imgError, setImgError] = useState(false);
  const { statut, driver, role } = result;
  const tone = TONE_STYLES[statut.tone] || TONE_STYLES.unk;

  const validityDate =
    driver?.typeBadge === 'permis' ? driver.permisExpiration : driver?.dateExpiration;

  return (
    <div className="space-y-4">
      {/* High-contrast Status Verdict Banner (Color + Icon + Bold Text) */}
      <div
        role="status"
        aria-live="polite"
        className={`rounded-2xl border p-5 sm:p-6 shadow-sm ${tone.banner}`}
      >
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-black/15 p-2.5">{tone.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-90">
              {tone.label}
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight leading-none mt-1">
              {statut.titre}
            </h2>
            <p className="mt-2 text-sm sm:text-base font-medium leading-snug opacity-95">
              {statut.sous}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-85 font-mono tabular-nums">
              <span>Horloge serveur : {formatServerTime(statut.serverTime)}</span>
              <span aria-hidden="true">·</span>
              <span>
                Vue : {role === 'admin' ? 'Administrateur' : role === 'agent' ? 'Agent habilité' : 'Public'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Driver Record Card (Minimized per role on server) */}
      {driver && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-5">
          <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            {driver.photoURL && !imgError ? (
              <img
                src={driver.photoURL}
                alt={`Photo de ${driver.prenoms}`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-24 w-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0"
              />
            ) : (
              <div className="flex h-24 w-20 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-400 shrink-0">
                <User className="h-9 w-9" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                Badge {driver.badgeNumero}
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight mt-0.5 truncate">
                {driver.prenoms} {driver.nom || ''}
              </h3>
              {driver.plaqueMoto && (
                <p className="mt-1 font-mono text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                  Plaque : {driver.plaqueMoto}
                </p>
              )}
            </div>
          </div>

          {role === 'public' ? (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                <Lock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  Fiche minimisée (vue publique). Connectez-vous avec un code agent pour consulter le nom complet, le n° de plaque, le permis et l'échéance.
                </span>
              </div>
              <button
                type="button"
                onClick={onRequestLogin}
                className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-amber-400 px-4 text-xs font-bold text-white dark:text-slate-950 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Accès agent
              </button>
            </div>
          ) : (
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div className="flex justify-between sm:block border-b sm:border-b-0 border-slate-100 dark:border-slate-800/70 pb-2 sm:pb-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Type de badge</dt>
                <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {driver.typeBadge === 'permis' ? 'Titulaire permis' : 'Provisoire (3 mois)'}
                </dd>
              </div>

              <div className="flex justify-between sm:block border-b sm:border-b-0 border-slate-100 dark:border-slate-800/70 pb-2 sm:pb-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Fin de validité</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                  {formatDateFr(validityDate)}
                </dd>
              </div>

              <div className="flex justify-between sm:block border-b sm:border-b-0 border-slate-100 dark:border-slate-800/70 pb-2 sm:pb-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Permis de conduire</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {role === 'admin' ? driver.permisNumero : driver.permisMasque}
                </dd>
              </div>

              <div className="flex justify-between sm:block">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Plaque moto</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                  {driver.plaqueMoto || '—'}
                </dd>
              </div>

              {role === 'admin' && (
                <>
                  <div className="flex justify-between sm:block border-t border-slate-100 dark:border-slate-800 pt-2">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Quartier</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {driver.quartier || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between sm:block border-t border-slate-100 dark:border-slate-800 pt-2">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Téléphone</dt>
                    <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {driver.telephone || '—'}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-300 active:scale-[0.99] cursor-pointer"
      >
        <RotateCcw className="h-4 w-4" />
        <span>Scanner un autre chauffeur</span>
      </button>
    </div>
  );
};
