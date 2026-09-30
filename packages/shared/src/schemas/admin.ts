import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from '../permissions.js';
import { pinSchema } from './auth.js';
import { idSchema } from './common.js';

export const userCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, {
    error: 'Code de 2 à 10 lettres majuscules ou chiffres (ex. PRE03)',
  });

export const createUserSchema = z.object({
  code: userCodeSchema,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, {
      error: 'Identifiant de 3 à 40 caractères (lettres, chiffres, . _ -)',
    }),
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.email({ error: 'E-mail invalide' }), z.literal('')]).optional(),
  roleId: idSchema,
  password: z.string().min(8).max(200),
  pin: pinSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.email({ error: 'E-mail invalide' }), z.literal('')]).optional(),
  roleId: idSchema,
  version: z.number().int(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetCredentialsSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  pin: pinSchema.optional(),
});

const permissionSchema = z.custom<Permission>(
  (v) => typeof v === 'string' && (ALL_PERMISSIONS as string[]).includes(v),
  {
    error: 'Permission inconnue',
  },
);

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(permissionSchema),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const renameDeviceSchema = z.object({ name: z.string().trim().min(2).max(60) });

export const updateSettingsSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});
