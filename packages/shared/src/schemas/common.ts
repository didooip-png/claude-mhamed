import { z } from 'zod';
import { isValidIsoDate } from '../dates.js';

export const idSchema = z.uuid({ error: 'Identifiant invalide' });

/** Montant en millimes (entier). */
export const millimesSchema = z.number().int({ error: 'Montant invalide' }).safe();
export const positiveMillimesSchema = millimesSchema.min(0, { error: 'Le montant doit être positif' });
export const bpSchema = z.number().int().min(0).max(10000);
export const qtySchema = z.number().int({ error: 'Quantité entière attendue' }).positive({ error: 'Quantité invalide' });

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { error: 'Date invalide (AAAA-MM-JJ attendu)' });

export const reasonSchema = z
  .string()
  .trim()
  .min(3, { error: 'Motif obligatoire (3 caractères minimum)' })
  .max(500);

export const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z
    .string()
    .regex(/^[a-zA-Z_.]+:(asc|desc)$/)
    .optional(),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Autorisation ponctuelle par un administrateur (🔑, §5.4). */
export const overrideSchema = z.object({
  userCode: z.string().trim().min(1).max(20),
  pin: z.string().regex(/^\d{4,6}$/, { error: 'PIN à 4–6 chiffres' }),
  reason: reasonSchema,
});
export type OverrideInput = z.infer<typeof overrideSchema>;

export const withOverride = { override: overrideSchema.optional() };
