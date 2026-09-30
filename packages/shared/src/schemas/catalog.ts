import { z } from 'zod';
import {
  CLIENT_TYPES,
  CONTROLLED_CLASSES,
  PRODUCT_CATEGORY_KINDS,
  SUPPLY_SOURCES,
} from '../enums.js';
import {
  bpSchema,
  idSchema,
  isoDateSchema,
  paginationSchema,
  positiveMillimesSchema,
} from './common.js';

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const keys = <T extends Record<string, string>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  name: text(80).min(2),
  kind: z.enum(keys(PRODUCT_CATEGORY_KINDS)),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const laboratorySchema = z.object({
  name: text(120).min(2),
  country: optional(60),
  isActive: z.boolean().default(true),
});
export type LaboratoryInput = z.infer<typeof laboratorySchema>;

export const therapeuticClassSchema = z.object({ name: text(120).min(2) });

export const tvaRateSchema = z.object({
  label: text(40).min(2),
  rateBp: z.number().int().min(0).max(10000),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type TvaRateInput = z.infer<typeof tvaRateSchema>;

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{4,32}$/, {
    error: 'Code-barres invalide (4 à 32 caractères alphanumériques)',
  });

export const productSchema = z
  .object({
    internalCode: text(30)
      .regex(/^[A-Za-z0-9._-]*$/, { error: 'Lettres, chiffres, . _ - uniquement' })
      .optional()
      .transform((v) => (v ? v.toUpperCase() : undefined)),
    name: text(160).min(2, { error: 'Nom commercial obligatoire' }),
    dci: optional(160),
    dosage: optional(60),
    form: optional(60),
    presentation: optional(80),
    laboratoryId: idSchema.nullish(),
    categoryId: idSchema,
    therapeuticClassId: idSchema.nullish(),
    tvaRateId: idSchema,
    refPurchasePriceHt: positiveMillimesSchema,
    salePriceTtc: positiveMillimesSchema,
    unitsPerPack: z.number().int().min(1).max(10000),
    sellByUnit: z.boolean(),
    unitSalePriceTtc: positiveMillimesSchema.nullish(),
    requiresPrescription: z.boolean(),
    controlledClass: z.enum(keys(CONTROLLED_CLASSES)),
    coldChain: z.boolean(),
    returnable: z.boolean(),
    location: optional(60),
    minStock: z.number().int().min(0),
    maxStock: z.number().int().min(0).nullish(),
    reorderPoint: z.number().int().min(0).nullish(),
    barcodes: z.array(barcodeSchema).max(10).default([]),
    isActive: z.boolean().default(true),
    version: z.number().int().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.sellByUnit && p.unitsPerPack < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitsPerPack'],
        message: 'Au moins 2 unités par boîte pour la vente à l’unité',
      });
    }
    if (p.sellByUnit && (p.unitSalePriceTtc === null || p.unitSalePriceTtc === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitSalePriceTtc'],
        message: 'Prix unitaire obligatoire pour la vente à l’unité',
      });
    }
    if (p.maxStock !== null && p.maxStock !== undefined && p.maxStock < p.minStock) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxStock'],
        message: 'Le stock maximum doit être supérieur au stock minimum',
      });
    }
    if (new Set(p.barcodes).size !== p.barcodes.length) {
      ctx.addIssue({ code: 'custom', path: ['barcodes'], message: 'Code-barres en double' });
    }
  });
export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

export const productQuerySchema = paginationSchema.extend({
  categoryId: idSchema.optional(),
  laboratoryId: idSchema.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  stock: z.enum(['OK', 'LOW', 'OUT']).optional(),
  location: z.string().trim().max(60).optional(),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

// ---------------------------------------------------------------------------
// Fournisseurs et clients
// ---------------------------------------------------------------------------

const email = z
  .union([z.email({ error: 'E-mail invalide' }), z.literal('')])
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null));
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+ ().-]{0,25}$/, { error: 'Téléphone invalide' })
  .nullish()
  .transform((v) => (v ? v : null));

export const supplierSchema = z.object({
  code: text(20)
    .regex(/^[A-Za-z0-9._-]*$/)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  name: text(160).min(2),
  taxId: optional(40),
  contactName: optional(120),
  phone,
  email,
  address: optional(300),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  leadTimeDays: z.number().int().min(0).max(120).nullish(),
  isActive: z.boolean().default(true),
  notes: optional(1000),
  version: z.number().int().optional(),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const EMAIL_DOC_PREF_KEYS = [
  'INVOICE',
  'INVOICE_CANCELLED',
  'CREDIT_NOTE',
  'PAYMENT_RECEIPT',
  'STATEMENT',
  'DUNNING',
] as const;

export const clientSchema = z.object({
  type: z.enum(keys(CLIENT_TYPES)),
  name: text(160).min(2, { error: 'Nom obligatoire' }),
  nationalIdOrTaxId: optional(40),
  phone,
  phone2: phone,
  email,
  address: optional(300),
  creditLimit: positiveMillimesSchema.default(0),
  defaultDiscountBp: bpSchema.default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  isActive: z.boolean().default(true),
  notes: optional(1000),
  emailConsent: z.boolean().default(false),
  emailDocPrefs: z.record(z.enum(EMAIL_DOC_PREF_KEYS), z.boolean()).optional(),
  emailCc: z
    .array(z.email({ error: 'E-mail en copie invalide' }))
    .max(5)
    .default([]),
  version: z.number().int().optional(),
});
export type ClientInput = z.input<typeof clientSchema>;

/** Création rapide depuis la caisse (nom + téléphone minimum, §6.6). */
export const quickClientSchema = z.object({
  name: text(160).min(2, { error: 'Nom obligatoire' }),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ ().-]{6,25}$/, { error: 'Téléphone obligatoire' }),
  type: z.enum(keys(CLIENT_TYPES)).default('INDIVIDUAL'),
  nationalIdOrTaxId: optional(40),
  email,
  emailConsent: z.boolean().default(false),
});
export type QuickClientInput = z.input<typeof quickClientSchema>;

// ---------------------------------------------------------------------------
// Réceptions (entrées en stock)
// ---------------------------------------------------------------------------

export const receiptLineSchema = z.object({
  id: idSchema.optional(),
  productId: idSchema,
  lotNumber: text(40).min(1, { error: 'Numéro de lot obligatoire' }),
  expiryDate: isoDateSchema,
  qty: z.number().int().min(0),
  freeQty: z.number().int().min(0).default(0),
  unitPriceHt: positiveMillimesSchema,
  discountBp: bpSchema.default(0),
  tvaRateBp: z.number().int().min(0).max(10000),
});
export type ReceiptLineInput = z.input<typeof receiptLineSchema>;

export const receiptSchema = z
  .object({
    sourceType: z.enum(keys(SUPPLY_SOURCES)),
    sourceReason: optional(300),
    supplierId: idSchema.nullish(),
    supplierInvoiceRef: optional(60),
    supplierInvoiceDate: isoDateSchema.nullish(),
    receivedAt: isoDateSchema,
    notes: optional(1000),
    attachmentId: idSchema.nullish(),
    /** Commande fournisseur à laquelle la réception est rattachée (contrôle des quantités). */
    purchaseOrderId: idSchema.nullish(),
    lines: z.array(receiptLineSchema).max(500),
    version: z.number().int().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.sourceType === 'SUPPLIER' && !r.supplierId) {
      ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Fournisseur obligatoire' });
    }
    if (r.sourceType === 'OTHER' && !r.sourceReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceReason'],
        message: 'Motif obligatoire pour une source « Autre »',
      });
    }
    r.lines.forEach((l, i) => {
      if (l.qty + (l.freeQty ?? 0) <= 0)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'qty'],
          message: 'Quantité obligatoire',
        });
    });
  });
export type ReceiptInput = z.input<typeof receiptSchema>;

export const validateReceiptSchema = z.object({
  /** Avertissements acceptés par l'utilisateur (péremption proche, écart de prix). */
  acknowledgeWarnings: z.boolean().default(false),
  updateReferencePrices: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export const movementQuerySchema = z.object({
  productId: idSchema,
  from: isoDateSchema,
  to: isoDateSchema.optional(),
  type: z.string().optional(),
  lotId: idSchema.optional(),
  userId: idSchema.optional(),
  counterpartId: idSchema.optional(),
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

export const lotBlockSchema = z.object({ reason: z.string().trim().min(3).max(300) });
