/**
 * Affichage des quantités : le stock est tenu en unité de base (RG-07).
 * Produit vendu à l'unité : « 3 bt + 5 u » ; sinon nombre de boîtes.
 */
export function formatStockQty(qtyBase: number, unitsPerPack: number, sellByUnit: boolean): string {
  if (!sellByUnit || unitsPerPack <= 1) return qtyBase.toLocaleString('fr-FR');
  const negative = qtyBase < 0;
  const abs = Math.abs(qtyBase);
  const packs = Math.floor(abs / unitsPerPack);
  const units = abs % unitsPerPack;
  const parts: string[] = [];
  if (packs > 0) parts.push(`${packs.toLocaleString('fr-FR')} bt`);
  if (units > 0 || packs === 0) parts.push(`${units} u`);
  return `${negative ? '−' : ''}${parts.join(' + ')}`;
}

/** Unité de base affichée à côté d'une quantité. */
export function baseUnitLabel(sellByUnit: boolean, unitsPerPack: number): string {
  return sellByUnit && unitsPerPack > 1 ? 'unités' : 'boîtes';
}
