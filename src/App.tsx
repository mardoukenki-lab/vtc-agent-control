import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LogOut,
  Moon,
  QrCode,
  ScanLine,
  Shield,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import { AdminConsole } from './components/AdminConsole';
import { OfflineBanner } from './components/OfflineBanner';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QrScannerView } from './components/QrScannerView';
import { TestBadgesPanel } from './components/TestBadgesPanel';
import { VerificationResultCard } from './components/VerificationResultCard';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { api, loadStoredSession, saveStoredSession } from './lib/api';
import type {
  AgentSession,
  ControlLogEntry,
  TestBadgeSample,
  VerifyResponse,
} from './types';

type ActiveTab = 'control' | 'history' | 'test' | 'admin';

const INACTIVITY_TIMEOUT_MS = 15 * 60_000;

export default function App() {
  const isOnline = useOnlineStatus();

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('allodabou_theme');
      if (saved === 'light') return false;
      return true;
    } catch {
      return true;
    }
  });

  const [session, setSession] = useState<AgentSession | null>(() => loadStoredSession());
  const [activeTab, setActiveTab] = useState<ActiveTab>('control');
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Login form state
  const [agentCode, setAgentCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showDemoCodes, setShowDemoCodes] = useState(false);

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);

  // Controls & Test Badges
  const [controls, setControls] = useState<ControlLogEntry[]>([]);
  const [testBadges, setTestBadges] = useState<TestBadgeSample[]>([]);

  const inactivityTimerRef = useRef<number | null>(null);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('allodabou_theme', 'dark');
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', '#0B1120');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('allodabou_theme', 'light');
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', '#F8FAFC');
    }
  }, [darkMode]);

  const handleLogout = useCallback(() => {
    saveStoredSession(null);
    setSession(null);
    setControls([]);
    setVerifyResult(null);
    if (activeTab === 'admin') {
      setActiveTab('control');
    }
  }, [activeTab]);

  // Verify active server session on mount
  useEffect(() => {
    if (!session) return;
    api.me(session.token).catch(() => {
      handleLogout();
    });
  }, [session, handleLogout]);

  // 15-minute inactivity auto-lock for patrol devices
  useEffect(() => {
    if (!session) return;
    const resetTimer = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(() => {
        handleLogout();
      }, INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [session, handleLogout]);

  const refreshControls = useCallback(async () => {
    if (!session || !isOnline) return;
    try {
      const res = await api.getControls(session.token);
      setControls(res.controls);
    } catch {
      // ignore transient error
    }
  }, [session, isOnline]);

  useEffect(() => {
    refreshControls();
  }, [refreshControls]);

  useEffect(() => {
    api
      .getTestBadges()
      .then((res) => setTestBadges(res.badges))
      .catch(() => {});
  }, []);

  const runVerification = useCallback(
    async (target: { token?: string; manualCode?: string }) => {
      setVerifyError(null);
      setIsVerifying(true);
      try {
        const res = await api.verify(target, session?.token);
        setVerifyResult(res);
        setActiveTab('control');
        if (session) {
          refreshControls();
        }
      } catch (err) {
        setVerifyError(
          err instanceof Error ? err.message : 'Vérification impossible. Vérifiez le réseau.'
        );
      } finally {
        setIsVerifying(false);
      }
    },
    [session, refreshControls]
  );

  // Extract QR token from #t=... fragment (or ?v=...) on initial load and scrub URL immediately
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const token =
      hashParams.get('t') ||
      hashParams.get('token') ||
      searchParams.get('t') ||
      searchParams.get('v');
    if (token) {
      window.history.replaceState(null, '', window.location.pathname);
      if (/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
        runVerification({ token });
      } else {
        runVerification({ manualCode: token.toUpperCase() });
      }
    }
  }, [runVerification]);

  const submitLogin = async (codeToUse: string) => {
    const trimmed = codeToUse.trim().toUpperCase();
    setLoginError(null);
    if (!trimmed) {
      setLoginError('Saisissez votre code personnel.');
      return;
    }
    setLoginLoading(true);
    try {
      const newSession = await api.login(trimmed);
      saveStoredSession(newSession);
      setSession(newSession);
      setAgentCode('');
      setShowLoginModal(false);
      setVerifyResult(null);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLoginForm = (e: React.FormEvent) => {
    e.preventDefault();
    submitLogin(agentCode);
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const toneDotColor = (tone: ControlLogEntry['tone']) => {
    if (tone === 'ok') return 'text-emerald-600 dark:text-emerald-400';
    if (tone === 'warn') return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B1120] dark:text-slate-50">
      <OfflineBanner />

      {/* TOP BAR CONTRACT: 3 clean zones (Brand wordmark | Single-line nav | Primary actions) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/90 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md pt-safe">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6">
          {/* Zone 1: Brand Wordmark (single text element) */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('control');
              setVerifyResult(null);
            }}
            className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Allô <span className="text-amber-500">Dabou</span>
          </button>

          {/* Zone 2: Desktop Single-Line Nav Links */}
          <nav
            aria-label="Navigation principale"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('control')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer ${
                activeTab === 'control'
                  ? 'text-slate-950 dark:text-amber-400 font-semibold underline underline-offset-8 decoration-2'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              Contrôle
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'text-slate-950 dark:text-amber-400 font-semibold underline underline-offset-8 decoration-2'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              Historique
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('test')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer ${
                activeTab === 'test'
                  ? 'text-slate-950 dark:text-amber-400 font-semibold underline underline-offset-8 decoration-2'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              Badges test
            </button>
            {session?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer ${
                  activeTab === 'admin'
                    ? 'text-slate-950 dark:text-amber-400 font-semibold underline underline-offset-8 decoration-2'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Administration
              </button>
            )}
          </nav>

          {/* Zone 3: Action Zone */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              aria-label={darkMode ? 'Passer en mode plein soleil' : 'Passer en mode nuit'}
              title={darkMode ? 'Mode plein soleil (jour)' : 'Mode patrouille (nuit)'}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>

            <PWAInstallButton />

            {session ? (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5 text-amber-500" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 px-3.5 text-xs font-bold text-white dark:text-slate-950 hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Accès agent</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-5 pb-24 md:pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT / PRIMARY WORKSPACE */}
          <section className="lg:col-span-7 space-y-4">
            {/* Agent Authentication Banner when not signed in on Control tab */}
            {!session && activeTab === 'control' && !verifyResult && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white text-balance">
                      Vérification des badges chauffeurs
                    </h1>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Identifiez-vous avec votre code personnel Police, Gendarmerie ou Autorité pour accéder aux fiches complètes et au journal de contrôle.
                    </p>
                  </div>
                  <Shield className="h-6 w-6 text-amber-500 shrink-0 mt-1" />
                </div>

                <form onSubmit={handleLoginForm} className="space-y-3">
                  <div>
                    <label
                      htmlFor="agent-code-main"
                      className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
                    >
                      Code d'accès individuel agent
                    </label>
                    <div className="relative flex gap-2">
                      <div className="relative flex-1">
                        <input
                          id="agent-code-main"
                          type={showCode ? 'text' : 'password'}
                          value={agentCode}
                          onChange={(e) => setAgentCode(e.target.value)}
                          placeholder="Ex : POL-2026-8491"
                          autoComplete="off"
                          className="min-h-[48px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-3.5 pr-11 font-mono text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCode((v) => !v)}
                          aria-label={showCode ? 'Masquer le code' : 'Afficher le code'}
                          className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={loginLoading || !isOnline}
                        className="min-h-[48px] rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {loginLoading ? 'Connexion…' : 'Valider'}
                      </button>
                    </div>
                  </div>

                  {loginError && (
                    <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">
                      {loginError}
                    </p>
                  )}
                </form>

                {/* Collapsible Demo Credentials Helper */}
                <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowDemoCodes((v) => !v)}
                    className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    {showDemoCodes
                      ? 'Masquer les codes de démonstration'
                      : 'Afficher les codes de démonstration (Police · Gendarmerie · Admin)'}
                  </button>

                  {showDemoCodes && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => submitLogin('POL-2026-8491')}
                        className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-left hover:border-amber-400 transition-colors cursor-pointer"
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          Police Nationale
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          POL-2026-8491
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => submitLogin('GEN-2026-3107')}
                        className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-left hover:border-amber-400 transition-colors cursor-pointer"
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          Gendarmerie
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          GEN-2026-3107
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => submitLogin('ADM-2026-9940')}
                        className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-left hover:border-amber-400 transition-colors cursor-pointer"
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          Administration
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          ADM-2026-9940
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Verification Error Banner */}
            {verifyError && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-2xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <span>{verifyError}</span>
              </div>
            )}

            {/* Active Tab Content */}
            {activeTab === 'control' &&
              (verifyResult ? (
                <VerificationResultCard
                  result={verifyResult}
                  onReset={() => {
                    setVerifyResult(null);
                    setVerifyError(null);
                  }}
                  onRequestLogin={() => setShowLoginModal(true)}
                />
              ) : (
                <QrScannerView
                  isOnline={isOnline}
                  isAgentAuthenticated={Boolean(session)}
                  isVerifying={isVerifying}
                  onDetected={runVerification}
                  onRequestLogin={() => setShowLoginModal(true)}
                />
              ))}

            {activeTab === 'history' && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                      Derniers contrôles enregistrés
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Journal horodaté sur le serveur
                    </p>
                  </div>
                  <History className="h-5 w-5 text-slate-400" />
                </div>

                {!session ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 text-center">
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                      Connectez-vous avec votre code agent pour consulter votre historique de contrôles.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowLoginModal(true)}
                      className="min-h-[44px] rounded-xl bg-amber-400 px-5 text-xs font-bold text-slate-950 cursor-pointer"
                    >
                      Se connecter
                    </button>
                  </div>
                ) : controls.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                    Aucun contrôle enregistré pour cette session.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {controls.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {c.driverName}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                            <span>{c.badgeNumero}</span>
                            <span aria-hidden="true">·</span>
                            <span>{c.method === 'qr' ? 'QR' : 'Manuel'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{formatTime(c.date)}</span>
                          </div>
                        </div>
                        <span className={`text-xs font-bold whitespace-nowrap ${toneDotColor(c.tone)}`}>
                          {c.statutCode}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'test' && (
              <TestBadgesPanel
                badges={testBadges}
                onSimulateScan={(token) => runVerification({ token })}
              />
            )}

            {activeTab === 'admin' && session?.role === 'admin' && (
              <AdminConsole
                authToken={session.token}
                onControlsUpdated={refreshControls}
              />
            )}
          </section>

          {/* RIGHT / SECONDARY COMMAND COLUMN (Visible on Desktop lg+, compact below on mobile when needed) */}
          <aside className="lg:col-span-5 space-y-4">
            {/* Active Agent Identity Summary */}
            {session && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Session agent active
                    </div>
                    <div className="font-display text-xl font-bold text-slate-900 dark:text-white truncate mt-0.5">
                      {session.nom}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{session.corps}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{session.matricule}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Verrouiller
                  </button>
                </div>
              </div>
            )}

            {/* Quick Recent Controls on Desktop */}
            {session && activeTab !== 'history' && (
              <div className="hidden lg:block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    Activité récente
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    Tout voir
                  </button>
                </div>
                {controls.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aucun contrôle effectué durant ce poste.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {controls.slice(0, 5).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {c.driverName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {c.badgeNumero} · {formatTime(c.date)}
                          </div>
                        </div>
                        <span className={`font-bold shrink-0 ${toneDotColor(c.tone)}`}>
                          {c.statutCode}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick Test Badges Launcher on Desktop */}
            {activeTab !== 'test' && testBadges.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                      Test rapide de badges
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Simuler un scan QR avec jeton cryptographique
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('test')}
                    className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap cursor-pointer"
                  >
                    Voir les QR
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {testBadges.map((b) => (
                    <button
                      key={b.badgeNumero}
                      type="button"
                      disabled={!isOnline || isVerifying}
                      onClick={() => runVerification({ token: b.qrToken })}
                      className="min-h-[52px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2.5 text-left hover:border-amber-400 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <div className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {b.badgeNumero}
                      </div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {b.expectedLabel}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* MOBILE BOTTOM TAB BAR (Thumb-zone navigation, compact height <= 15% cap) */}
      <nav
        aria-label="Navigation mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-md pb-safe"
      >
        <div
          className={`grid h-14 items-center ${
            session?.role === 'admin' ? 'grid-cols-4' : 'grid-cols-3'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('control')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'control'
                ? 'text-amber-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <ScanLine className="h-5 w-5" />
            <span className="text-[10px] tracking-tight">Contrôle</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'history'
                ? 'text-amber-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <History className="h-5 w-5" />
            <span className="text-[10px] tracking-tight">Historique</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('test')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'test'
                ? 'text-amber-500 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <QrCode className="h-5 w-5" />
            <span className="text-[10px] tracking-tight">Badges</span>
          </button>

          {session?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`flex h-full flex-col items-center justify-center gap-0.5 cursor-pointer ${
                activeTab === 'admin'
                  ? 'text-amber-500 font-bold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <SlidersHorizontal className="h-5 w-5" />
              <span className="text-[10px] tracking-tight">Admin</span>
            </button>
          )}
        </div>
      </nav>

      {/* AGENT LOGIN MODAL (Triggered from header or public view) */}
      {showLoginModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-login-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2
                  id="modal-login-title"
                  className="font-display text-2xl font-bold text-slate-900 dark:text-white"
                >
                  Connexion agent habilité
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Police Nationale, Gendarmerie Nationale et Autorités
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="min-h-[40px] rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Fermer
              </button>
            </div>

            <form onSubmit={handleLoginForm} className="space-y-3">
              <input
                type={showCode ? 'text' : 'password'}
                value={agentCode}
                onChange={(e) => setAgentCode(e.target.value)}
                placeholder="Code personnel (ex: POL-2026-8491)"
                autoComplete="off"
                autoFocus
                className="min-h-[48px] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 font-mono text-sm text-slate-900 dark:text-white"
              />
              {loginError && (
                <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">
                  {loginError}
                </p>
              )}
              <button
                type="submit"
                disabled={loginLoading || !isOnline}
                className="min-h-[48px] w-full rounded-xl bg-amber-400 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 cursor-pointer"
              >
                {loginLoading ? 'Vérification…' : 'Accéder au contrôle'}
              </button>
            </form>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => submitLogin('POL-2026-8491')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-center hover:border-amber-400 cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 dark:text-white">Police</div>
                <div className="font-mono text-[10px] text-slate-500">POL-2026…</div>
              </button>
              <button
                type="button"
                onClick={() => submitLogin('GEN-2026-3107')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-center hover:border-amber-400 cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 dark:text-white">Gendarme</div>
                <div className="font-mono text-[10px] text-slate-500">GEN-2026…</div>
              </button>
              <button
                type="button"
                onClick={() => submitLogin('ADM-2026-9940')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-center hover:border-amber-400 cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 dark:text-white">Admin</div>
                <div className="font-mono text-[10px] text-slate-500">ADM-2026…</div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
