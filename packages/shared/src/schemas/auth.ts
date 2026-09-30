import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1, { error: 'Identifiant obligatoire' }).max(60),
  password: z.string().min(1, { error: 'Mot de passe obligatoire' }).max(200),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const pinSchema = z.string().regex(/^\d{4,6}$/, { error: 'Le PIN doit comporter 4 à 6 chiffres' });

export const switchUserSchema = z.object({
  userCode: z.string().trim().min(1).max(20),
  pin: pinSchema,
});
export type SwitchUserInput = z.infer<typeof switchUserSchema>;

export const unlockSchema = z.object({ pin: pinSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, { error: '8 caractères minimum' }).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changePinSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPin: pinSchema,
});

export const verifyPinSchema = z.object({ pin: pinSchema });

export const registerDeviceSchema = z.object({
  name: z.string().trim().min(2, { error: 'Nom du poste obligatoire' }).max(60),
  kind: z.enum(['WEB', 'DESKTOP']).default('WEB'),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/** Politique de mot de passe : longueur minimale + au moins une lettre et un chiffre. */
export function checkPasswordPolicy(password: string, minLength = 8): string | null {
  if (password.length < minLength) return `Le mot de passe doit contenir au moins ${minLength} caractères.`;
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}
