import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Flashlight, ImageUp, Keyboard, Loader2 } from 'lucide-react';
import { extractQrTarget } from '../lib/api';

interface QrScannerViewProps {
  isOnline: boolean;
  isAgentAuthenticated: boolean;
  isVerifying: boolean;
  onDetected: (target: { token?: string; manualCode?: string }) => void;
  onRequestLogin?: () => void;
}

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
}

export const QrScannerView: React.FC<QrScannerViewProps> = ({
  isOnline,
  isAgentAuthenticated,
  isVerifying,
  onDetected,
  onRequestLogin,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastDetectedRef = useRef<string>('');

  const [scanning, setScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleDecodedRaw = useCallback(
    (raw: string) => {
      const cleaned = raw.trim();
      if (!cleaned || cleaned === lastDetectedRef.current) return;
      lastDetectedRef.current = cleaned;
      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
      stopCamera();
      const target = extractQrTarget(cleaned);
      onDetected(target);
      setTimeout(() => {
        lastDetectedRef.current = '';
      }, 1500);
    },
    [onDetected, stopCamera]
  );

  const startCamera = async () => {
    setScanError(null);
    if (!isOnline) {
      setScanError('Connexion requise pour vérifier un badge en temps réel.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanError(
        'Caméra indisponible dans ce navigateur ou contexte non sécurisé. Utilisez l’import d’image ou le code manuel.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(Boolean(caps.torch));
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // Optional native BarcodeDetector fast path (falls back to bundled jsQR)
      let detector: BarcodeDetectorLike | null = null;
      const Win = window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
      };
      if (typeof Win.BarcodeDetector === 'function') {
        try {
          detector = new Win.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          if (detector) {
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0 && codes[0].rawValue) {
                handleDecodedRaw(codes[0].rawValue);
                return;
              }
            } catch {
              detector = null;
            }
          }

          const canvas = canvasRef.current || document.createElement('canvas');
          canvasRef.current = canvas;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (result && result.data) {
              handleDecodedRaw(result.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopCamera();
      setScanError(
        'Accès caméra refusé ou appareil photo absent. Autorisez la caméra, importez une image QR ou saisissez le code.'
      );
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanError(null);

    if (!isOnline) {
      setScanError('Connexion requise pour vérifier un badge.');
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas indisponible');
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'attemptBoth',
      });
      bitmap.close?.();
      if (!result || !result.data) {
        setScanError('Aucun QR code détecté sur cette image. Essayez une photo plus nette.');
        return;
      }
      handleDecodedRaw(result.data);
    } catch {
      setScanError("Impossible d'analyser cette image.");
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setScanError(null);
    const val = manualInput.trim().toUpperCase();
    if (!val) return;
    if (!isOnline) {
      setScanError('Pas de connexion réseau : vérification impossible.');
      return;
    }
    onDetected({ manualCode: val });
    setManualInput('');
  };

  return (
    <div className="space-y-4">
      {/* Camera Viewport / Launch Area */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Contrôle par scan QR
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Visez le QR code imprimé sur le badge du chauffeur
            </p>
          </div>
          {scanning && torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'}
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                torchOn
                  ? 'border-amber-400 bg-amber-400 text-slate-950'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
              }`}
            >
              <Flashlight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Video Container */}
        <div
          className={`relative overflow-hidden rounded-xl bg-slate-950 ${
            scanning ? 'aspect-square max-h-[380px] w-full mx-auto' : 'hidden'
          }`}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[62%] w-[62%] rounded-2xl border-2 border-amber-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]" />
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex justify-center">
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white border border-slate-700 hover:bg-slate-800 cursor-pointer"
            >
              <CameraOff className="h-4 w-4" />
              <span>Arrêter la caméra</span>
            </button>
          </div>
        </div>

        {/* Action Buttons when camera is idle */}
        {!scanning && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!isOnline || isVerifying}
              onClick={startCamera}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-300 disabled:opacity-50 active:scale-[0.99] cursor-pointer"
            >
              {isVerifying ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
              <span>Scanner un badge QR</span>
            </button>

            <button
              type="button"
              disabled={!isOnline || isVerifying}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <ImageUp className="h-4 w-4 text-amber-500" />
              <span>Importer une photo QR</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        )}

        {scanError && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
          >
            {scanError}
          </p>
        )}
      </div>

      {/* Manual Fallback (Agent Only) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <label
            htmlFor="manual-code-input"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            <Keyboard className="h-4 w-4 text-slate-400" />
            <span>Saisie manuelle de secours</span>
          </label>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Code court ou n° badge
          </span>
        </div>

        {isAgentAuthenticated ? (
          <form onSubmit={handleManualSubmit} className="flex gap-2.5">
            <input
              id="manual-code-input"
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value.toUpperCase())}
              placeholder="Ex : K9M4P2W7 ou ADB-0001"
              autoCapitalize="characters"
              autoComplete="off"
              className="min-h-[46px] flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 font-mono text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!isOnline || isVerifying || !manualInput.trim()}
              className="min-h-[46px] rounded-xl bg-slate-900 dark:bg-slate-100 px-5 text-sm font-bold text-white dark:text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              Vérifier
            </button>
          </form>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-3.5">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Pour prévenir l'énumération des badges, la saisie manuelle est réservée aux agents connectés.
            </p>
            {onRequestLogin && (
              <button
                type="button"
                onClick={onRequestLogin}
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-bold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Connexion agent
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
