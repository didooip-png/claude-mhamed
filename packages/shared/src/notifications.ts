import type { NotificationMode } from './enums.js';

/**
 * Catalogue des événements notifiables (§6.19 B) et abonnements par défaut d'un administrateur.
 * Un utilisateur sans abonnement enregistré pour un événement reçoit le mode par défaut.
 */

export const NOTIFICATION_GROUPS = {
  activity: 'Activité des employés',
  stock: 'Stock',
  finance: 'Clients & finances',
  system: 'Système',
} as const;
export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS;

/** Seuil applicable : montant (millimes) ou remise (points de base). */
export type NotificationThreshold = 'amount' | 'discount';

export interface NotifiableEventDefinition {
  group: NotificationGroup;
  label: string;
  defaultMode: NotificationMode;
  threshold?: NotificationThreshold;
  /** Alerte critique système : au moins un administrateur doit rester abonné par e-mail. */
  critical?: boolean;
  /** Événement déclenché par un employé (filtre « employés suivis » applicable). */
  employee?: boolean;
}

const e = (
  group: NotificationGroup,
  label: string,
  defaultMode: NotificationMode,
  extra: Partial<NotifiableEventDefinition> = {},
): NotifiableEventDefinition => ({ group, label, defaultMode, ...extra });

const events = {
  // Activité des employés
  SALE_CANCELLED: e('activity', 'Vente annulée', 'EMAIL_IMMEDIATE', {
    threshold: 'amount',
    employee: true,
  }),
  SALE_MODIFIED: e('activity', 'Vente modifiée', 'EMAIL_IMMEDIATE', {
    threshold: 'amount',
    employee: true,
  }),
  EXCESSIVE_CANCELLATIONS: e(
    'activity',
    'Trop d’annulations par un utilisateur dans la journée',
    'EMAIL_IMMEDIATE',
    { employee: true },
  ),
  CART_LINE_REMOVED: e('activity', 'Ligne retirée du panier', 'OFF', {
    threshold: 'amount',
    employee: true,
  }),
  EXCESSIVE_LINE_REMOVALS: e(
    'activity',
    'Trop de lignes retirées par un utilisateur dans la journée',
    'IN_APP',
    { employee: true },
  ),
  DRAFT_SALE_DISCARDED: e('activity', 'Panier abandonné', 'OFF', {
    threshold: 'amount',
    employee: true,
  }),
  DISCOUNT_OVER_LIMIT: e('activity', 'Remise au-delà du plafond', 'IN_APP', {
    threshold: 'discount',
    employee: true,
  }),
  PRICE_OVERRIDE: e('activity', 'Prix modifié en vente', 'IN_APP', { employee: true }),
  LOT_FORCED: e('activity', 'Lot forcé hors règle FEFO/FIFO', 'IN_APP', { employee: true }),
  SALE_BELOW_COST: e('activity', 'Vente sous le coût du lot', 'IN_APP', { employee: true }),
  ADMIN_OVERRIDE: e('activity', 'Code administrateur utilisé', 'IN_APP', { employee: true }),
  CUSTOMER_RETURN: e('activity', 'Retour client', 'IN_APP', {
    threshold: 'amount',
    employee: true,
  }),
  CASH_REFUND: e('activity', 'Remboursement en espèces', 'IN_APP', {
    threshold: 'amount',
    employee: true,
  }),
  DOCUMENT_REPRINTED: e('activity', 'Réimpression de ticket / facture', 'OFF', { employee: true }),
  CASH_DRAWER_OPENED: e('activity', 'Tiroir-caisse ouvert sans vente', 'IN_APP', {
    employee: true,
  }),
  CASH_SESSION_OPENED: e('activity', 'Ouverture de caisse', 'OFF', { employee: true }),
  CASH_SESSION_CLOSED: e('activity', 'Clôture de caisse', 'OFF', { employee: true }),
  CASH_DISCREPANCY: e('activity', 'Écart de caisse', 'EMAIL_IMMEDIATE', {
    threshold: 'amount',
    employee: true,
  }),
  RECEIPT_VALIDATED: e('activity', 'Réception validée', 'OFF', {
    threshold: 'amount',
    employee: true,
  }),
  RECEIPT_CANCELLED: e('activity', 'Réception annulée', 'IN_APP', { employee: true }),
  ADJUSTMENT_DECLARED: e('activity', 'Perte / casse déclarée en attente de validation', 'IN_APP', {
    employee: true,
  }),
  INVENTORY_READY: e('activity', 'Inventaire prêt à valider', 'IN_APP', { employee: true }),
  INVENTORY_VALIDATED: e('activity', 'Inventaire validé (écarts corrigés)', 'IN_APP', {
    threshold: 'amount',
  }),
  STOCK_ADJUSTMENT: e('activity', 'Ajustement de stock validé', 'IN_APP', {
    threshold: 'amount',
    employee: true,
  }),
  SUPPLIER_RETURN: e('activity', 'Retour fournisseur enregistré', 'IN_APP', { employee: true }),
  OUTSIDE_HOURS_ACTIVITY: e('activity', 'Connexion ou opération hors horaires', 'IN_APP', {
    employee: true,
  }),
  LOGIN_FAILED: e('activity', 'Échec de connexion', 'OFF', { employee: true }),
  ACCOUNT_LOCKED: e('activity', 'Compte verrouillé', 'IN_APP', { employee: true }),
  DEVICE_REGISTERED: e('activity', 'Nouveau poste en attente d’approbation', 'IN_APP'),
  // Stock
  STOCK_OUT: e('stock', 'Rupture de stock', 'EMAIL_DAILY'),
  STOCK_LOW: e('stock', 'Passage sous le seuil minimum', 'IN_APP'),
  LOT_RECALL: e('stock', 'Rappel de lot lancé', 'EMAIL_IMMEDIATE'),
  LOTS_EXPIRING: e('stock', 'Lots proches de la péremption', 'EMAIL_DAILY'),
  LOTS_EXPIRED: e('stock', 'Lots périmés encore en stock', 'EMAIL_DAILY'),
  REORDER_SUGGESTIONS: e('stock', 'Suggestions de réapprovisionnement', 'IN_APP'),
  STOCK_INCONSISTENCY: e('stock', 'Incohérence de stock détectée', 'EMAIL_IMMEDIATE', {
    critical: true,
  }),
  // Clients & finances
  CREDIT_LIMIT_OVERRIDE: e('finance', 'Plafond de crédit dépassé', 'IN_APP', { employee: true }),
  INVOICES_OVERDUE: e('finance', 'Factures échues', 'IN_APP'),
  CHEQUE_BOUNCED: e('finance', 'Chèque impayé', 'IN_APP', { employee: true }),
  PAYMENT_CANCELLED: e('finance', 'Règlement annulé', 'IN_APP', { employee: true }),
  PAYMENT_RECEIVED: e('finance', 'Règlement important reçu', 'OFF', {
    threshold: 'amount',
    employee: true,
  }),
  // Système
  BACKUP_FAILED: e('system', 'Sauvegarde échouée', 'EMAIL_IMMEDIATE', { critical: true }),
  AUDIT_INTEGRITY_FAILED: e(
    'system',
    'Échec de la vérification d’intégrité du journal',
    'EMAIL_IMMEDIATE',
    { critical: true },
  ),
  EMAIL_DELIVERY_FAILED: e('system', 'Échecs répétés d’envoi d’e-mails', 'IN_APP'),
} as const satisfies Record<string, NotifiableEventDefinition>;

export type NotifiableEventType = keyof typeof events;
export const NOTIFIABLE_EVENTS: Record<NotifiableEventType, NotifiableEventDefinition> = events;

export function isNotifiableEvent(type: string): type is NotifiableEventType {
  return Object.prototype.hasOwnProperty.call(events, type);
}

/** Seuils d'un abonnement : montant minimal (millimes) et remise minimale (points de base). */
export interface NotificationThresholds {
  minAmount?: number;
  minDiscountBp?: number;
}
