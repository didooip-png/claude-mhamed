/** Commandes ESC/POS envoyées à l'imprimante de tickets. */

/**
 * Impulsion d'ouverture du tiroir-caisse : ESC p m t1 t2 (broche 2, ~100 ms de marche, ~400 ms de repos).
 * Valable pour les tiroirs branchés sur l'imprimante (prise RJ11/RJ12) des principaux fabricants.
 */
export function openDrawerCommand(pin: 0 | 1 = 0): Buffer {
  return Buffer.from([0x1b, 0x70, pin, 0x32, 0xc8]);
}
