import { type HelpRole, TOUR_STORAGE_KEY, helpRoleOf } from '@pharmastock/shared';
import * as React from 'react';
import { useMe } from '@/lib/auth';

const OPEN_HELP = 'pharmastock:open-help';
const START_TOUR = 'pharmastock:start-tour';
/** Positionner cette clé à « 1 » désactive le lancement automatique de la visite (tests, démonstrations). */
export const TOUR_DISABLED_KEY = 'pharmastock.tour.disabled';

/** Ouvre le panneau d'aide de l'écran courant (bouton « ? », touche F1). */
export function openHelp(): void {
  window.dispatchEvent(new Event(OPEN_HELP));
}

/** Relance la visite guidée. */
export function startTour(): void {
  window.dispatchEvent(new Event(START_TOUR));
}

export function useHelpEvent(kind: 'open' | 'tour', handler: () => void): void {
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => {
    const name = kind === 'open' ? OPEN_HELP : START_TOUR;
    const listener = () => ref.current();
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [kind]);
}

/** Rôle d'aide de l'utilisateur connecté (administrateur, sinon préparateur). */
export function useHelpRole(): HelpRole {
  return helpRoleOf(useMe().role.isAdmin);
}

const seenKey = (userId: string) => `${TOUR_STORAGE_KEY}.${userId}`;

export function tourSeen(userId: string): boolean {
  try {
    return (
      localStorage.getItem(TOUR_DISABLED_KEY) === '1' ||
      localStorage.getItem(seenKey(userId)) === '1'
    );
  } catch {
    // Stockage indisponible : on ne harcèle pas l'utilisateur à chaque page.
    return true;
  }
}

export function markTourSeen(userId: string): void {
  try {
    localStorage.setItem(seenKey(userId), '1');
  } catch {
    /* sans effet */
  }
}
