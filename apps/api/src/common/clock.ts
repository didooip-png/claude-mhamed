/**
 * Horloge du serveur : SEULE source d'horodatage des opérations (§3.1).
 * L'heure du poste client n'est jamais utilisée.
 *
 * `setSeedClock` n'existe que pour générer l'historique des données de démonstration
 * (seed) ; il est refusé hors du script de seed.
 */
let override: Date | null = null;
let seedMode = false;

export function now(): Date {
  return override ? new Date(override.getTime()) : new Date();
}

export function enableSeedClock(): void {
  seedMode = true;
}

export function setSeedClock(date: Date | null): void {
  if (!seedMode) throw new Error('Horloge figée réservée au script de données de démonstration');
  override = date;
}
