import { z } from 'zod';

/**
 * Paramètres métier (§6.17). Chaque clé a un schéma de validation, une valeur par défaut,
 * un libellé et un groupe d'affichage. Toute modification est tracée au mouchard.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Format HH:MM attendu' });
const dayHours = z.array(z.object({ open: hhmm, close: hhmm })).max(3);

export const DOC_AUTO_MODES = ['AUTO', 'MANUAL', 'DISABLED'] as const;
export type DocAutoMode = (typeof DOC_AUTO_MODES)[number];

export const EMAIL_DOCUMENT_KINDS = {
  INVOICE: 'Facture',
  INVOICE_CANCELLED: 'Facture annulée / remplacée',
  CREDIT_NOTE: 'Avoir',
  PAYMENT_RECEIPT: 'Reçu de règlement',
  STATEMENT: 'Relevé de compte',
  DUNNING: 'Relance de facture échue',
  PURCHASE_ORDER: 'Bon de commande fournisseur',
} as const;
export type EmailDocumentKind = keyof typeof EMAIL_DOCUMENT_KINDS;

export const DEFAULT_DENOMINATIONS = [
  { value: 50000, label: 'Billet 50 DT' },
  { value: 20000, label: 'Billet 20 DT' },
  { value: 10000, label: 'Billet 10 DT' },
  { value: 5000, label: 'Billet / pièce 5 DT' },
  { value: 2000, label: 'Pièce 2 DT' },
  { value: 1000, label: 'Pièce 1 DT' },
  { value: 500, label: 'Pièce 500 millimes' },
  { value: 200, label: 'Pièce 200 millimes' },
  { value: 100, label: 'Pièce 100 millimes' },
  { value: 50, label: 'Pièce 50 millimes' },
  { value: 20, label: 'Pièce 20 millimes' },
  { value: 10, label: 'Pièce 10 millimes' },
];

const weekDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEK_DAY_LABELS: Record<(typeof weekDays)[number], string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
};

export const SETTINGS_GROUPS = {
  establishment: 'Établissement',
  general: 'Général',
  stock: 'Stock et péremptions',
  tax: 'TVA et timbre fiscal',
  numbering: 'Numérotation des documents',
  sales: 'Ventes',
  returns: 'Retours',
  cash: 'Caisse',
  security: 'Sécurité',
  alerts: 'Alertes',
  email: 'E-mails aux clients',
} as const;
export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

function def<S extends z.ZodType>(
  group: SettingsGroup,
  label: string,
  schema: S,
  defaultValue: z.infer<S>,
  help?: string,
) {
  return { group, label, schema, defaultValue, help };
}

export const SETTINGS_DEFINITIONS = {
  // Établissement
  'establishment.name': def(
    'establishment',
    'Nom de l’établissement',
    z.string().min(1).max(120),
    'Pharmacie PharmaStock',
  ),
  'establishment.address': def('establishment', 'Adresse', z.string().max(300), ''),
  'establishment.phone': def('establishment', 'Téléphone', z.string().max(40), ''),
  'establishment.email': def('establishment', 'E-mail', z.union([z.email(), z.literal('')]), ''),
  'establishment.tax_id': def('establishment', 'Matricule fiscal', z.string().max(40), ''),
  'establishment.trade_register': def(
    'establishment',
    'Registre de commerce',
    z.string().max(60),
    '',
  ),
  'establishment.legal_footer': def(
    'establishment',
    'Mentions légales en pied de document',
    z.string().max(500),
    '',
  ),
  'establishment.logo_attachment_id': def('establishment', 'Logo', z.string().nullable(), null),
  'establishment.primary_color': def(
    'establishment',
    'Couleur principale (e-mails, documents)',
    z.string().regex(/^#[0-9a-fA-F]{6}$/),
    '#0f766e',
  ),
  // Général
  'general.currency_code': def('general', 'Devise', z.string().min(1).max(8), 'DT'),
  'general.currency_name': def(
    'general',
    'Nom de la devise (montant en lettres)',
    z.string().min(1).max(20),
    'dinar',
  ),
  'general.currency_decimals': def(
    'general',
    'Décimales affichées',
    z.number().int().min(0).max(3),
    3,
  ),
  'general.timezone': def('general', 'Fuseau horaire', z.string().min(1), 'Africa/Tunis'),
  'general.business_hours': def(
    'general',
    'Horaires d’ouverture (alertes « hors horaires »)',
    z.object(
      Object.fromEntries(weekDays.map((d) => [d, dayHours])) as Record<
        (typeof weekDays)[number],
        typeof dayHours
      >,
    ),
    {
      mon: [{ open: '08:00', close: '20:00' }],
      tue: [{ open: '08:00', close: '20:00' }],
      wed: [{ open: '08:00', close: '20:00' }],
      thu: [{ open: '08:00', close: '20:00' }],
      fri: [{ open: '08:00', close: '20:00' }],
      sat: [{ open: '08:00', close: '14:00' }],
      sun: [],
    },
  ),
  // Stock
  'stock.exit_rule': def(
    'stock',
    'Règle de sortie des lots',
    z.enum(['FEFO', 'FIFO']),
    'FEFO',
    'FEFO : premier périmé, premier sorti (recommandé). FIFO strict : premier reçu, premier sorti.',
  ),
  'stock.sale_block_days': def(
    'stock',
    'Bloquer la vente si péremption dans moins de (jours)',
    z.number().int().min(0).max(365),
    0,
  ),
  'stock.expiry_alert_days': def(
    'stock',
    'Seuils d’alerte de péremption (jours)',
    z.array(z.number().int().min(1).max(730)).min(1).max(5),
    [90, 60, 30],
  ),
  'stock.expiry_orange_days': def(
    'stock',
    'Couleur orange si péremption dans moins de (jours)',
    z.number().int().min(1),
    30,
  ),
  'stock.expiry_yellow_days': def(
    'stock',
    'Couleur jaune si péremption dans moins de (jours)',
    z.number().int().min(1),
    90,
  ),
  'stock.receipt_expiry_warning_months': def(
    'stock',
    'Avertir à la réception si péremption dans moins de (mois)',
    z.number().int().min(0).max(36),
    6,
  ),
  'stock.receipt_price_variance_pct': def(
    'stock',
    'Avertir si le prix d’achat varie de plus de (%)',
    z.number().int().min(1).max(500),
    15,
  ),
  'stock.reorder_consumption_days': def(
    'stock',
    'Période de consommation pour les suggestions de réapprovisionnement (jours)',
    z.number().int().min(7).max(365),
    90,
  ),
  'stock.default_supplier_lead_days': def(
    'stock',
    'Délai fournisseur par défaut (jours)',
    z.number().int().min(0).max(120),
    3,
  ),
  'stock.dormant_days': def(
    'stock',
    'Produit dormant si aucune vente depuis (jours)',
    z.number().int().min(7).max(730),
    90,
  ),
  // TVA
  'tax.stamp_duty_amount': def(
    'tax',
    'Timbre fiscal (millimes)',
    z.number().int().min(0),
    1000,
    'Valeur à confirmer avec le comptable.',
  ),
  'tax.stamp_duty_scope': def(
    'tax',
    'Application du timbre fiscal',
    z.enum(['ALL', 'PROFESSIONAL', 'NONE']),
    'PROFESSIONAL',
    'PROFESSIONAL : factures des clients professionnels (pharmacie, clinique, entreprise…). ALL : toutes les ventes.',
  ),
  // Numérotation
  'numbering.prefixes': def(
    'numbering',
    'Préfixes des documents',
    z.object({
      FAC: z.string().min(1).max(8),
      AV: z.string().min(1).max(8),
      REG: z.string().min(1).max(8),
      REC: z.string().min(1).max(8),
      RT: z.string().min(1).max(8),
      RF: z.string().min(1).max(8),
      INV: z.string().min(1).max(8),
      AJ: z.string().min(1).max(8),
      CS: z.string().min(1).max(8),
    }),
    {
      FAC: 'FAC',
      AV: 'AV',
      REG: 'REG',
      REC: 'REC',
      RT: 'RT',
      RF: 'RF',
      INV: 'INV',
      AJ: 'AJ',
      CS: 'CS',
    },
    'Format : PRÉFIXE-AAAA-NNNNNN. Le changement s’applique aux prochains numéros.',
  ),
  // Ventes
  'sales.preparer_max_discount_bp': def(
    'sales',
    'Remise maximale préparateur (points de base, 500 = 5 %)',
    z.number().int().min(0).max(10000),
    500,
  ),
  'sales.walk_in_client_enabled': def(
    'sales',
    'Autoriser le « client comptoir » (acheteur non identifié)',
    z.boolean(),
    false,
  ),
  'sales.require_pin_on_validation': def(
    'sales',
    'Exiger le PIN à chaque validation de vente',
    z.boolean(),
    false,
  ),
  'sales.prescription_required_for': def(
    'sales',
    'Informations d’ordonnance obligatoires pour',
    z.enum(['PRESCRIPTION_AND_CONTROLLED', 'CONTROLLED_ONLY', 'NONE']),
    'PRESCRIPTION_AND_CONTROLLED',
  ),
  'sales.default_document': def(
    'sales',
    'Document imprimé par défaut',
    z.enum(['TICKET', 'A4', 'NONE']),
    'TICKET',
  ),
  // Retours
  'returns.max_days': def(
    'returns',
    'Délai maximum de retour (jours)',
    z.number().int().min(0).max(365),
    15,
  ),
  'returns.require_admin_code': def(
    'returns',
    'Code administrateur exigé pour un retour',
    z.boolean(),
    true,
  ),
  'returns.cash_refund_allowed': def(
    'returns',
    'Remboursement en espèces autorisé (administrateur)',
    z.boolean(),
    true,
  ),
  'returns.allow_without_sale': def(
    'returns',
    'Retour sans vente d’origine (administrateur)',
    z.boolean(),
    false,
  ),
  // Caisse
  'cash.required_for_cash_payments': def(
    'cash',
    'Session de caisse obligatoire pour les espèces',
    z.boolean(),
    true,
  ),
  'cash.discrepancy_threshold': def(
    'cash',
    'Seuil d’alerte d’écart de caisse (millimes)',
    z.number().int().min(0),
    5000,
  ),
  'cash.denominations': def(
    'cash',
    'Coupures (comptage de clôture)',
    z.array(z.object({ value: z.number().int().positive(), label: z.string().min(1) })).min(1),
    DEFAULT_DENOMINATIONS,
    'Liste pré-remplie avec les billets et pièces tunisiens : à vérifier.',
  ),
  // Sécurité
  'security.inactivity_lock_minutes': def(
    'security',
    'Verrouillage après inactivité (minutes, 0 = jamais)',
    z.number().int().min(0).max(240),
    10,
  ),
  'security.password_min_length': def(
    'security',
    'Longueur minimale du mot de passe',
    z.number().int().min(8).max(64),
    8,
  ),
  'security.max_failed_attempts': def(
    'security',
    'Échecs avant verrouillage du compte',
    z.number().int().min(3).max(20),
    5,
  ),
  'security.lock_duration_minutes': def(
    'security',
    'Durée du verrouillage du compte (minutes)',
    z.number().int().min(1).max(1440),
    15,
  ),
  'security.require_device_approval': def(
    'security',
    'Approbation des nouveaux postes par un administrateur',
    z.boolean(),
    true,
  ),
  // Alertes
  'alerts.max_cancellations_per_user_day': def(
    'alerts',
    'Alerte si un utilisateur dépasse N annulations par jour',
    z.number().int().min(1),
    3,
  ),
  'alerts.max_line_removals_per_user_day': def(
    'alerts',
    'Alerte si un utilisateur dépasse N retraits de lignes par jour',
    z.number().int().min(1),
    10,
  ),
  'alerts.burst_threshold': def(
    'alerts',
    'Regroupement anti-rafale : au-delà de N e-mails identiques en 10 min',
    z.number().int().min(1).max(50),
    5,
  ),
  // E-mails clients
  'email.auto_send': def(
    'email',
    'Envoi des documents aux clients',
    z.object({
      INVOICE: z.enum(DOC_AUTO_MODES),
      INVOICE_CANCELLED: z.enum(DOC_AUTO_MODES),
      CREDIT_NOTE: z.enum(DOC_AUTO_MODES),
      PAYMENT_RECEIPT: z.enum(DOC_AUTO_MODES),
      STATEMENT: z.enum(DOC_AUTO_MODES),
      DUNNING: z.enum(DOC_AUTO_MODES),
      PURCHASE_ORDER: z.enum(DOC_AUTO_MODES),
    }),
    {
      INVOICE: 'AUTO',
      INVOICE_CANCELLED: 'AUTO',
      CREDIT_NOTE: 'AUTO',
      PAYMENT_RECEIPT: 'AUTO',
      STATEMENT: 'MANUAL',
      DUNNING: 'DISABLED',
      PURCHASE_ORDER: 'MANUAL',
    },
  ),
  'email.dunning_schedule_days': def(
    'email',
    'Relances : jours après échéance',
    z.array(z.number().int().min(1).max(365)).min(1).max(3),
    [7, 15, 30],
  ),
  'email.pdf_password_protection': def(
    'email',
    'Protéger les PDF par un mot de passe communiqué au client',
    z.boolean(),
    false,
  ),
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<
  (typeof SETTINGS_DEFINITIONS)[K]['schema']
>;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_DEFINITIONS, key);
}

export function defaultSettings(): SettingsMap {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS)
    out[key] = JSON.parse(JSON.stringify(SETTINGS_DEFINITIONS[key].defaultValue)) as unknown;
  return out as SettingsMap;
}

/** Paramètres qu'un utilisateur non administrateur peut lire (affichage, règles de caisse). */
export const PUBLIC_SETTING_KEYS: SettingKey[] = SETTING_KEYS.filter(
  (k) => !k.startsWith('email.') && k !== 'security.require_device_approval',
);
