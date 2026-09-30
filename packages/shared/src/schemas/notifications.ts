import { z } from 'zod';
import { idSchema } from './common.js';

const modeSchema = z.enum(['OFF', 'IN_APP', 'EMAIL_IMMEDIATE', 'EMAIL_DAILY', 'EMAIL_WEEKLY']);

export const notificationScheduleSchema = z.object({
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});

export const notificationSubscriptionSchema = z.object({
  eventType: z.string().min(1).max(100),
  mode: modeSchema,
  /** Employés suivis ; vide = tous. */
  watchedUserIds: z.array(idSchema).max(200).default([]),
  thresholds: z
    .object({
      minAmount: z.number().int().min(0).optional(),
      minDiscountBp: z.number().int().min(0).max(10_000).optional(),
    })
    .default({}),
  outsideHoursOnly: z.boolean().default(false),
  schedule: notificationScheduleSchema.default({}),
});
export type NotificationSubscriptionInput = z.output<typeof notificationSubscriptionSchema>;

export const notificationPreferencesSchema = z.object({
  /** Adresse de réception ; vide = adresse du compte. */
  notificationEmail: z
    .union([z.email({ error: 'E-mail invalide' }), z.literal('')])
    .nullish()
    .transform((v) => (v ? v : null)),
  subscriptions: z.array(notificationSubscriptionSchema).max(100),
});
export type NotificationPreferencesInput = z.output<typeof notificationPreferencesSchema>;
