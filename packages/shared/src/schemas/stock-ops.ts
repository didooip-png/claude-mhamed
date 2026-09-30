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
// Inventaire (§6.12)
// ---------------------------------------------------------------------------

export const INVENTORY_SCOPE_KINDS = {
  ALL: 'Inventaire complet',
  CATEGORY: 'Par catégorie',
  LABORATORY: 'Par laboratoire',
  LOCATION: 'Par emplacement',
  PRODUCTS: 'Sélection de produits',
} as const;
export type InventoryScopeKind = keyof typeof INVENTORY_SCOPE_KINDS;

export const inventoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({ kind: z.literal('CATEGORY'), ids: z.array(idSchema).min(1).max(200) }),
  z.object({ kind: z.literal('LABORATORY'), ids: z.array(idSchema).min(1).max(200) }),
  z.object({
    kind: z.literal('LOCATION'),
    locations: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  }),
  z.object({ kind: z.literal('PRODUCTS'), ids: z.array(idSchema).min(1).max(2000) }),
]);
export type InventoryScope = z.infer<typeof inventoryScopeSchema>;

export const createInventorySchema = z.object({
  scope: inventoryScopeSchema,
  /** Inclure les lots épuisés (théorique 0) pour retrouver du stock non enregistré. */
  includeEmptyLots: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

export const inventoryCountSchema = z.object({
  counts: z
    .array(
      z.object({
        lineId: idSchema,
        /** Quantité comptée, en unités de base. */
        countedQty: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(500),
});

export const inventoryAddLotSchema = z.object({
  lotId: idSchema,
  countedQty: z.number().int().min(0).max(10_000_000),
});

export const validateInventorySchema = z.object({
  /** Valider même si des lignes n'ont pas été comptées (elles restent inchangées). */
  ignoreUncounted: z.boolean().default(false),
});

export const inventoryLinesQuerySchema = paginationSchema.extend({
  filter: z.enum(['ALL', 'UNCOUNTED', 'COUNTED', 'DIFFERENCES']).default('ALL'),
  productId: idSchema.optional(),
});

export const inventoryListQuerySchema = paginationSchema.extend({
  status: z.enum(['COUNTING', 'VALIDATED', 'CANCELLED']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Ajustements de stock (§6.12)
// ---------------------------------------------------------------------------

const adjustmentTypeKeys = ['LOSS', 'BREAKAGE', 'EXPIRED_DESTRUCTION', 'CORRECTION'] as const;

export const adjustmentLineSchema = z.object({
  lotId: idSchema,
  /**
   * Perte, casse, destruction : quantité positive à retirer. Correction : quantité signée
   * (négative = retrait, positive = ajout). Toujours en unités de base.
   */
  qty: z.number().int().min(-10_000_000).max(10_000_000),
});

export const createAdjustmentSchema = z
  .object({
    type: z.enum(adjustmentTypeKeys),
    reason: reasonSchema,
    lines: z.array(adjustmentLineSchema).min(1, { error: 'Ajoutez au moins un lot' }).max(200),
    /** Administrateur : valide immédiatement (création + validation en une opération). */
    validateNow: z.boolean().default(false),
  })
  .superRefine((a, ctx) => {
    a.lines.forEach((l, i) => {
      if (l.qty === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'qty'],
          message: 'Quantité nulle interdite',
        });
      if (a.type !== 'CORRECTION' && l.qty < 0)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'qty'],
          message: 'Saisissez une quantité positive (elle sera retirée du stock)',
        });
    });
    const lots = a.lines.map((l) => l.lotId);
    if (new Set(lots).size !== lots.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Un lot ne peut figurer qu’une fois',
      });
  });

export const rejectAdjustmentSchema = z.object({ reason: reasonSchema });

export const adjustmentListQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'VALIDATED', 'REJECTED']).optional(),
  type: z.enum(adjustmentTypeKeys).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Retours fournisseurs (§6.13)
// ---------------------------------------------------------------------------

export const SUPPLIER_RETURN_REASONS = {
  EXPIRED: 'Produit périmé',
  DEFECTIVE: 'Produit défectueux',
  DELIVERY_ERROR: 'Erreur de livraison',
  RECALL: 'Rappel de lot',
  OTHER: 'Autre',
} as const;
export type SupplierReturnReasonKey = keyof typeof SUPPLIER_RETURN_REASONS;

export const supplierReturnLineSchema = z.object({
  lotId: idSchema,
  qty: qtySchema,
  reason: reasonSchema,
});

export const createSupplierReturnSchema = z
  .object({
    supplierId: idSchema,
    reason: reasonSchema,
    notes: z.string().trim().max(500).optional(),
    lines: z.array(supplierReturnLineSchema).min(1, { error: 'Ajoutez au moins un lot' }).max(200),
  })
  .superRefine((r, ctx) => {
    const lots = r.lines.map((l) => l.lotId);
    if (new Set(lots).size !== lots.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Un lot ne peut figurer qu’une fois',
      });
  });

export const supplierCreditSchema = z.object({
  amount: positiveMillimesSchema.refine((v) => v > 0, { error: 'Montant invalide' }),
  reference: z.string().trim().min(1, { error: 'Référence de l’avoir obligatoire' }).max(100),
  receivedAt: isoDateSchema.optional(),
});

export const cancelSupplierReturnSchema = z.object({ reason: reasonSchema });

export const supplierReturnListQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING_CREDIT', 'CREDIT_RECEIVED', 'CANCELLED']).optional(),
  supplierId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Rappel de lot (§6.4, §6.13)
// ---------------------------------------------------------------------------

export const recallLookupSchema = z.object({
  lotNumber: z.string().trim().min(1, { error: 'Numéro de lot obligatoire' }).max(100),
  productId: idSchema.optional(),
});

export const executeRecallSchema = z.object({
  lotNumber: z.string().trim().min(1).max(100),
  productId: idSchema.optional(),
  /** Lots à bloquer ; par défaut tous les lots correspondants encore en stock. */
  lotIds: z.array(idSchema).max(200).optional(),
  reason: reasonSchema,
});
