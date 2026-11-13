import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-300 active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-4 w-4 shrink-0" />
        <span>Installer l'app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="h-4 w-4 shrink-0 text-amber-500" />
          <span>Installer</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <h3
                  id="ios-install-title"
                  className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white"
                >
                  Installer sur iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Fermer"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-bold text-amber-500 mt-0.5">1.</span>
                  <span>
                    Appuyez sur le bouton <strong className="inline-flex items-center gap-1 text-slate-900 dark:text-white"><Share className="h-3.5 w-3.5" /> Partager</strong> dans la barre Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-bold text-amber-500 mt-0.5">2.</span>
                  <span>
                    Faites défiler et touchez <strong className="text-slate-900 dark:text-white">Sur l'écran d'accueil</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-bold text-amber-500 mt-0.5">3.</span>
                  <span>Confirmez avec <strong className="text-slate-900 dark:text-white">Ajouter</strong> pour lancer en plein écran.</span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-amber-400 text-sm font-bold text-white dark:text-slate-950 transition-colors hover:opacity-90 cursor-pointer"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
