import { z } from 'zod';
import {
  idSchema,
  isoDateSchema,
  paginationSchema,
  positiveMillimesSchema,
  qtySchema,
  reasonSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Commandes fournisseurs (§6.3)
// ---------------------------------------------------------------------------

export const purchaseOrderLineSchema = z.object({
  productId: idSchema,
  /** Quantité commandée dans l'unité de réception (boîtes). */
  qty: qtySchema,
  /** Prix d'achat unitaire HT estimé ; par défaut le prix de référence du produit. */
  unitPriceHt: positiveMillimesSchema.optional(),
});

export const purchaseOrderSchema = z
  .object({
    supplierId: idSchema,
    expectedDate: isoDateSchema.nullish(),
    notes: z.string().trim().max(1000).optional(),
    lines: z
      .array(purchaseOrderLineSchema)
      .min(1, { error: 'Ajoutez au moins un produit' })
      .max(500),
    version: z.number().int().optional(),
  })
  .superRefine((o, ctx) => {
    const ids = o.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Un produit ne peut figurer qu’une fois dans la commande',
      });
  });
export type PurchaseOrderInput = z.output<typeof purchaseOrderSchema>;

export const ordersFromSuggestionsSchema = z.object({
  supplierId: idSchema,
  /** Restreint aux produits cochés ; par défaut toutes les suggestions du fournisseur. */
  productIds: z.array(idSchema).max(500).optional(),
  /** Inclut les produits sans fournisseur habituel. */
  includeUnassigned: z.boolean().default(false),
});

export const sendPurchaseOrderSchema = z.object({
  /** Adresses du fournisseur ; vide = pas d'envoi par e-mail (commande imprimée ou téléphonée). */
  to: z
    .array(z.email({ error: 'E-mail invalide' }))
    .max(5)
    .default([]),
  cc: z
    .array(z.email({ error: 'E-mail invalide' }))
    .max(5)
    .default([]),
  message: z.string().trim().max(1000).optional(),
});

export const cancelPurchaseOrderSchema = z.object({ reason: reasonSchema });

export const purchaseOrderListQuerySchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  supplierId: idSchema.optional(),
  open: z.enum(['0', '1']).optional(),
});
