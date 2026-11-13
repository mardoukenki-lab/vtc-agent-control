import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      className="border-b border-red-700 bg-red-600 px-4 py-2.5 text-white"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2.5 text-sm font-semibold">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          Pas de connexion réseau : contrôle en temps réel impossible (aucune donnée chauffeur stockée hors ligne).
        </span>
      </div>
    </div>
  );
};
