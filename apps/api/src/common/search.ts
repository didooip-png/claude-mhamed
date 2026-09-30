/** Normalise un texte pour la recherche : minuscules, sans accents ni ponctuation. */
export function normalizeSearch(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%.,/+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
