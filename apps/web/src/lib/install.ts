import * as React from 'react';

/**
 * Installation de l'application (PWA) depuis le navigateur, sans magasin d'applications.
 *
 * - Chrome / Edge / Samsung Internet (Android, PC) : l'événement `beforeinstallprompt` permet
 *   d'afficher la fenêtre d'installation native depuis notre propre bouton.
 * - iPhone / iPad : aucun événement n'existe ; l'installation se fait par « Partager → Sur l'écran
 *   d'accueil » — on affiche donc des instructions pas à pas.
 * - Android sans événement (page en HTTP, navigateur non compatible) : instructions du menu ⋮.
 *
 * L'écouteur est posé dès l'import du module : l'événement peut survenir avant le premier rendu.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'hidden' | 'prompt' | 'manual';
export type InstallPlatform = 'ios' | 'android' | 'desktop';

let deferred: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // on affiche notre bouton, pas la mini-barre du navigateur
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installedFlag = true;
    deferred = null;
    emit();
  });
}

export function detectPlatform(ua = navigator.userAgent): InstallPlatform {
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Vrai si l'application tourne déjà « installée » (fenêtre autonome) ou dans l'application de bureau. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    !!window.pharmastockDesktop
  );
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export interface InstallState {
  mode: InstallMode;
  platform: InstallPlatform;
  /** Ouvre la fenêtre native (mode « prompt »), retourne false si l'utilisateur refuse. */
  install: () => Promise<boolean>;
}

export function useInstall(): InstallState {
  const hasPrompt = React.useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
  const installed = React.useSyncExternalStore(
    subscribe,
    () => installedFlag,
    () => false,
  );
  const platform = React.useMemo(() => detectPlatform(), []);
  const mode: InstallMode =
    installed || isStandalone()
      ? 'hidden'
      : hasPrompt
        ? 'prompt'
        : platform === 'desktop'
          ? 'hidden' // navigateurs de bureau sans installation possible : rien à proposer
          : 'manual';
  const install = React.useCallback(async () => {
    const event = deferred;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    deferred = null; // l'événement n'est utilisable qu'une fois
    emit();
    return outcome === 'accepted';
  }, []);
  return { mode, platform, install };
}
