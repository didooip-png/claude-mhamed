import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

/**
 * Installation en application (PWA) : le service worker ne met en cache que les fichiers du
 * site (aucune donnée métier, aucun mode hors ligne en v1). Une nouvelle version est proposée
 * à l'utilisateur, jamais imposée en pleine vente.
 */
export function setupPwa(): void {
  if (!import.meta.env.PROD || window.pharmastockDesktop || !('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      toast('Une nouvelle version de PharmaStock est disponible.', {
        id: 'pwa-update',
        duration: Infinity,
        action: { label: 'Mettre à jour', onClick: () => void update(true) },
      });
    },
  });
}
