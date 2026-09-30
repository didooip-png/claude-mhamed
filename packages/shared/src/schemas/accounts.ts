import { z } from 'zod';
import {
  idSchema,
  isoDateSchema,
  overrideSchema,
  paginationSchema,
  positiveMillimesSchema,
  qtySchema,
  reasonSchema,
} from './common.js';
import { paymentFields, refinePayment, saleUnitSchema } from './sales.js';

// ---------------------------------------------------------------------------
// Retours clients et avoirs (§6.8, RG-14)
// ---------------------------------------------------------------------------

/** État du produit retourné : revendable, quarantaine ou destruction. */
export const RETURN_CONDITIONS = {
  RESELLABLE: 'Revendable — remis en stock dans son lot',
  QUARANTINE: 'Non revendable — mis en quarantaine',
  DESTROY: 'Non revendable — détruit',
} as const;
export type ReturnCondition = keyof typeof RETURN_CONDITIONS;

const conditionKeys = Object.keys(RETURN_CONDITIONS) as [ReturnCondition, ...ReturnCondition[]];

export const returnEntrySchema = z.object({
  /** Ligne de la vente d'origine (retour avec vente). */
  saleLineId: idSchema.optional(),
  /** Produit (retour sans vente d'origine, administrateur). */
  productId: idSchema.optional(),
  /** Lot inscrit sur la boîte, parmi les lots sortis pour cette ligne. */
  lotId: idSchema,
  qty: qtySchema,
  unit: saleUnitSchema.default('PACK'),
  condition: z.enum(conditionKeys).default('RESELLABLE'),
  /** Montant remboursé de l'entrée (uniquement sans vente d'origine). */
  amount: positiveMillimesSchema.optional(),
});
export type ReturnEntryInput = z.input<typeof returnEntrySchema>;

export const createReturnSchema = z
  .object({
    saleId: idSchema.nullish(),
    clientId: idSchema.nullish(),
    reason: reasonSchema,
    refundMode: z.enum(['CREDIT', 'CASH']).default('CREDIT'),
    entries: z
      .array(returnEntrySchema)
      .min(1, { error: 'Sélectionnez au moins un produit' })
      .max(100),
    override: overrideSchema.optional(),
    /** Absent : règle automatique (Automatique + consentement). */
    sendEmail: z.boolean().optional(),
    emailTo: z.email({ error: 'E-mail invalide' }).nullish(),
  })
  .superRefine((r, ctx) => {
    if (r.saleId) {
      if (r.entries.some((e) => !e.saleLineId)) {
        ctx.addIssue({ code: 'custom', path: ['entries'], message: 'Ligne de vente manquante' });
      }
    } else {
      if (!r.clientId) {
        ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Client obligatoire' });
      }
      if (r.entries.some((e) => !e.productId || !e.amount)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Produit et montant obligatoires',
        });
      }
    }
  });
export type CreateReturnInput = z.input<typeof createReturnSchema>;
export type CreateReturnData = z.output<typeof createReturnSchema>;

export const returnListSchema = paginationSchema.extend({
  clientId: idSchema.optional(),
  saleId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Règlements et lettrage (§6.10, RG-16)
// ---------------------------------------------------------------------------

export const allocationItemSchema = z.object({
  saleId: idSchema,
  amount: positiveMillimesSchema.refine((v) => v > 0, { error: 'Montant obligatoire' }),
});

export const recordPaymentSchema = z
  .object({
    ...paymentFields,
    clientId: idSchema,
    notes: z.string().trim().max(300).nullish(),
    /** AUTO : factures les plus anciennes d'abord ; MANUAL : facture par facture ; NONE : acompte. */
    allocation: z.enum(['AUTO', 'MANUAL', 'NONE']).default('AUTO'),
    items: z.array(allocationItemSchema).max(100).default([]),
    sendEmail: z.boolean().optional(),
    emailTo: z.email({ error: 'E-mail invalide' }).nullish(),
  })
  .superRefine((p, ctx) => {
    refinePayment(p, ctx);
    if (p.allocation === 'MANUAL') {
      const total = p.items.reduce((a, i) => a + i.amount, 0);
      if (p.items.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'Indiquez les factures à régler',
        });
      }
      if (total > p.amount) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'Les affectations dépassent le règlement',
        });
      }
    }
  });
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentData = z.output<typeof recordPaymentSchema>;

/** Lettrage sans nouvel encaissement : avoirs et acomptes existants sur des factures. */
export const settleSchema = z.object({
  /** AUTO : tout le crédit disponible sur les factures les plus anciennes. */
  mode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
  items: z
    .array(
      z.object({
        sourceKind: z.enum(['PAYMENT', 'CREDIT_NOTE']),
        sourceId: idSchema,
        saleId: idSchema,
        amount: positiveMillimesSchema.refine((v) => v > 0, { error: 'Montant obligatoire' }),
      }),
    )
    .max(100)
    .default([]),
});
export type SettleInput = z.input<typeof settleSchema>;
export type SettleData = z.output<typeof settleSchema>;

export const paymentListSchema = paginationSchema.extend({
  clientId: idSchema.optional(),
  method: z.enum(['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL']).optional(),
  status: z.enum(['VALID', 'CANCELLED', 'BOUNCED']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  unallocated: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

export const cancelPaymentSchema = z.object({ reason: reasonSchema });

export const chequeStatusSchema = z.object({ status: z.enum(['DEPOSITED', 'CASHED']) });

export const chequeListSchema = paginationSchema.extend({
  status: z.enum(['IN_PORTFOLIO', 'DEPOSITED', 'CASHED', 'BOUNCED']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  clientId: idSchema.optional(),
});

export const agingQuerySchema = z.object({ asOf: isoDateSchema.optional() });

export const ledgerQuerySchema = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const statementQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    format: z.enum(['pdf', 'xlsx']).default('pdf'),
  })
  .refine((q) => q.from <= q.to, { error: 'La période est inversée', path: ['to'] });

export const sendStatementSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    recipients: z
      .array(z.email({ error: 'E-mail invalide' }))
      .max(5)
      .default([]),
    cc: z
      .array(z.email({ error: 'E-mail invalide' }))
      .max(5)
      .default([]),
    message: z.string().trim().max(1000).nullish(),
    confirmNoConsent: z.boolean().default(false),
  })
  .refine((q) => q.from <= q.to, { error: 'La période est inversée', path: ['to'] });
