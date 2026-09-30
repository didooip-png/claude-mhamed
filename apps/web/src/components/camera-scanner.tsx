import { Loader2, ScanLine } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMediaQuery } from '@/lib/media';

/** API « Barcode Detection » (Chrome Android, Edge, Samsung Internet) — non typée par TypeScript. */
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

const detectorCtor = (): BarcodeDetectorCtor | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window
    ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
    : null;

/** Formats utiles en pharmacie : EAN/UPC, Code 128 et Data Matrix (boîtes de médicaments). */
const WANTED = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'data_matrix',
  'qr_code',
];

/**
 * Le bouton « scanner avec la caméra » n'apparaît que sur un appareil tactile dont le navigateur
 * sait lire les codes-barres (page servie en HTTPS obligatoire pour accéder à la caméra).
 */
export function useCameraScanSupported(): boolean {
  const touch = useMediaQuery('(pointer: coarse)');
  return (
    touch &&
    detectorCtor() !== null &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext
  );
}

export function CameraScannerDialog({
  open,
  onOpenChange,
  onDetect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetect: (code: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);
  const onDetectRef = React.useRef(onDetect);
  onDetectRef.current = onDetect;

  React.useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    setError(null);
    setStarting(true);
    (async () => {
      try {
        const Ctor = detectorCtor();
        if (!Ctor) throw new Error('unsupported');
        const supported = await Ctor.getSupportedFormats();
        const detector = new Ctor({ formats: WANTED.filter((f) => supported.includes(f)) });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStarting(false);
        const tick = async () => {
          if (cancelled) return;
          try {
            const found = await detector.detect(video);
            const code = found[0]?.rawValue;
            if (code) {
              navigator.vibrate?.(60);
              onDetectRef.current(code);
              onOpenChange(false);
              return;
            }
          } catch {
            /* image pas encore prête : on réessaie */
          }
          timer = window.setTimeout(() => void tick(), 180);
        };
        void tick();
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'L’accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.'
            : name === 'NotFoundError'
              ? 'Aucune caméra n’a été trouvée sur cet appareil.'
              : 'La caméra ne peut pas être utilisée ici (elle exige une connexion sécurisée HTTPS).',
        );
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="size-4" /> Scanner un code-barres
          </DialogTitle>
          <DialogDescription>
            Placez le code-barres (ou le code Data Matrix) de la boîte dans le cadre.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Fermer
        </Button>
      </DialogContent>
    </Dialog>
  );
}
