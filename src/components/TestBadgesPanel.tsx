import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, QrCode, ScanLine } from 'lucide-react';
import type { TestBadgeSample } from '../types';

interface TestBadgesPanelProps {
  badges: TestBadgeSample[];
  onSimulateScan: (token: string) => void;
}

export const TestBadgesPanel: React.FC<TestBadgesPanelProps> = ({
  badges,
  onSimulateScan,
}) => {
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    async function generateAll() {
      const origin = window.location.origin;
      const entries: Record<string, string> = {};
      for (const b of badges) {
        const payload = `${origin}/#t=${b.qrToken}`;
        try {
          entries[b.badgeNumero] = await QRCode.toDataURL(payload, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 240,
            color: {
              dark: '#0B1120',
              light: '#FFFFFF',
            },
          });
        } catch {
          // ignore
        }
      }
      if (active) setQrUrls(entries);
    }
    if (badges.length > 0) {
      generateAll();
    }
    return () => {
      active = false;
    };
  }, [badges]);

  const toneText = (tone: TestBadgeSample['tone']) => {
    if (tone === 'ok') return 'text-emerald-600 dark:text-emerald-400';
    if (tone === 'warn') return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Badges de test QR (jetons aléatoires)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Scannez ces QR codes avec un second appareil, téléchargez l'image PNG pour l'importer, ou simulez directement le scan.
            </p>
          </div>
          <QrCode className="h-5 w-5 text-amber-500 shrink-0" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {badges.map((b) => {
            const dataUrl = qrUrls[b.badgeNumero];
            return (
              <div
                key={b.badgeNumero}
                className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="h-24 w-24 shrink-0 rounded-lg bg-white p-1.5 border border-slate-200">
                    {dataUrl ? (
                      <img
                        src={dataUrl}
                        alt={`QR badge ${b.badgeNumero}`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="h-full w-full bg-slate-100" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">
                      {b.badgeNumero} · {b.shortCode}
                    </div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-white truncate mt-0.5">
                      {b.driverName}
                    </div>
                    <div className={`text-xs font-bold mt-1 ${toneText(b.tone)}`}>
                      {b.expectedLabel}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-1 truncate">
                      #t={b.qrToken.slice(0, 10)}…
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onSimulateScan(b.qrToken)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 transition-colors cursor-pointer"
                  >
                    <ScanLine className="h-3.5 w-3.5" />
                    <span>Simuler scan</span>
                  </button>
                  {dataUrl && (
                    <a
                      href={dataUrl}
                      download={`badge-${b.badgeNumero}.png`}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>PNG</span>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
