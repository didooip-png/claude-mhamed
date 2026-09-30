import * as React from 'react';

/** Suit une requête média CSS (rendu adaptatif côté JavaScript : cartes au lieu de tableaux, etc.). */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Téléphone (< 768 px) : mise en page en cartes, feuilles de dialogue, barre de navigation basse. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
