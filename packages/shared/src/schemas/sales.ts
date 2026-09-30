import { z } from 'zod';
import {
  bpSchema,
  idSchema,
  isoDateSchema,
  overrideSchema,
  positiveMillimesSchema,
  qtySchema,
  reasonSchema,
} from './common.js';

export const saleUnitSchema = z.enum(['PACK', 'UNIT']);

export const createSaleSchema = z.object({ clientId: idSchema.nullish() });

export const addSaleLineSchema = z.object({
  productId: idSchema,
  qty: qtySchema.default(1),
  unit: saleUnitSchema.default('PACK'),
});
export type AddSaleLineInput = z.input<typeof addSaleLineSchema>;

export const updateSaleLineSchema = z.object({
  qty: qtySchema.optional(),
  unit: saleUnitSchema.optional(),
  discountBp: bpSchema.optional(),
  unitPriceTtc: positiveMillimesSchema.optional(),
  forcedLotId: idSchema.nullish(),
  override: overrideSchema.optional(),
});
export type UpdateSaleLineInput = z.input<typeof updateSaleLineSchema>;

export const setSaleClientSchema = z.object({ clientId: idSchema.nullable() });

export const globalDiscountSchema = z.object({
  discountBp: bpSchema,
  override: overrideSchema.optional(),
});

export const prescriptionSchema = z.object({
  prescriberName: z.string().trim().max(120).nullish(),
  prescriptionRef: z.string().trim().max(60).nullish(),
  prescriptionDate: isoDateSchema.nullish(),
});
export type PrescriptionInput = z.input<typeof prescriptionSchema>;

export const PAYMENT_INPUT_METHODS = ['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL'] as const;

export const paymentInputSchema = z
  .object({
    method: z.enum(PAYMENT_INPUT_METHODS),
    /** Montant affecté (en espèces : hors monnaie rendue). */
    amount: positiveMillimesSchema.refine((v) => v > 0, { error: 'Montant obligatoire' }),
    /** Espèces remises par le client (calcul du rendu). */
    tendered: positiveMillimesSchema.optional(),
    chequeNumber: z.string().trim().max(40).nullish(),
    bank: z.string().trim().max(60).nullish(),
    dueDate: isoDateSchema.nullish(),
    reference: z.string().trim().max(80).nullish(),
  })
  .superRefine((p, ctx) => {
    if (p.method === 'CHEQUE' && (!p.chequeNumber || !p.bank)) {
      ctx.addIssue({
        code: 'custom',
        path: ['chequeNumber'],
        message: 'N° de chèque et banque obligatoires',
      });
    }
    if (p.method === 'TRANSFER' && !p.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Référence du virement obligatoire',
      });
    }
    if (p.method === 'DRAFT_BILL' && !p.dueDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Échéance de la traite obligatoire',
      });
    }
    if (p.tendered !== undefined && p.method === 'CASH' && p.tendered < p.amount) {
      ctx.addIssue({ code: 'custom', path: ['tendered'], message: 'Montant remis insuffisant' });
    }
  });
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const validateSaleSchema = z.object({
  payments: z.array(paymentInputSchema).max(6).default([]),
  /** Montant réglé avec l'avoir / le crédit disponible du client. */
  useCredit: positiveMillimesSchema.default(0),
  document: z.enum(['TICKET', 'A4', 'NONE']).default('TICKET'),
  /** Absent : règle automatique (mode « Automatique » + consentement) ; true / false : choix explicite. */
  sendEmail: z.boolean().optional(),
  emailTo: z.email({ error: 'E-mail invalide' }).nullish(),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
  override: overrideSchema.optional(),
});
export type ValidateSaleInput = z.input<typeof validateSaleSchema>;

export const CANCEL_REASONS = {
  CUSTOMER_REQUEST: 'Demande du client',
  ENTRY_ERROR: 'Erreur de saisie',
  WRONG_PRODUCT: 'Erreur de produit',
  PAYMENT_ISSUE: 'Problème de paiement',
  DUPLICATE: 'Vente en double',
  OTHER: 'Autre',
} as const;

export const cancelSaleSchema = z.object({
  reasonCode: z.enum(
    Object.keys(CANCEL_REASONS) as [
      keyof typeof CANCEL_REASONS,
      ...(keyof typeof CANCEL_REASONS)[],
    ],
  ),
  reason: reasonSchema,
  /** Règlements de la vente : remboursés (sortie de caisse) ou convertis en crédit client. */
  refundMode: z.enum(['REFUND', 'CREDIT']),
});
export type CancelSaleInput = z.input<typeof cancelSaleSchema>;

export const modifySaleLineSchema = z.object({
  productId: idSchema,
  qty: qtySchema,
  unit: saleUnitSchema.default('PACK'),
  discountBp: bpSchema.default(0),
  unitPriceTtc: positiveMillimesSchema.optional(),
  forcedLotId: idSchema.nullish(),
});

export const modifySaleSchema = z.object({
  reasonCode: z.enum(
    Object.keys(CANCEL_REASONS) as [
      keyof typeof CANCEL_REASONS,
      ...(keyof typeof CANCEL_REASONS)[],
    ],
  ),
  reason: reasonSchema,
  clientId: idSchema.optional(),
  lines: z.array(modifySaleLineSchema).min(1).max(200),
  prescription: prescriptionSchema.optional(),
  /** Encaissements complémentaires si le nouveau total dépasse les règlements transférés. */
  payments: z.array(paymentInputSchema).max(6).default([]),
  /** Excédent de règlements si le nouveau total est inférieur : crédit client ou remboursement. */
  excessMode: z.enum(['CREDIT', 'REFUND']).default('CREDIT'),
  override: overrideSchema.optional(),
});
export type ModifySaleInput = z.input<typeof modifySaleSchema>;

export const reprintSchema = z.object({ format: z.enum(['TICKET', 'A4']).default('A4') });

// ---------------------------------------------------------------------------
// Caisse
// ---------------------------------------------------------------------------

export const openCashSessionSchema = z.object({
  openingFloat: positiveMillimesSchema,
  notes: z.string().trim().max(300).nullish(),
});

export const cashMovementSchema = z.object({
  type: z.enum(['EXPENSE', 'DEPOSIT', 'WITHDRAWAL', 'DRAWER_OPEN']),
  amount: positiveMillimesSchema.default(0),
  reason: reasonSchema,
  override: overrideSchema.optional(),
});

export const closeCashSessionSchema = z.object({
  denominations: z
    .array(
      z.object({ value: z.number().int().positive(), count: z.number().int().min(0).max(100_000) }),
    )
    .max(40),
  notes: z.string().trim().max(500).nullish(),
});
export type CloseCashSessionInput = z.input<typeof closeCashSessionSchema>;
