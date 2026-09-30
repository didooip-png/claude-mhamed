/** Énumérations métier partagées (valeurs stockées en base, en anglais ; libellés en français). */

function labels<const T extends Record<string, string>>(map: T) {
  return map;
}

export const STOCK_MOVEMENT_TYPES = labels({
  PURCHASE_IN: 'Achat (réception)',
  SALE_OUT: 'Vente',
  SALE_CANCEL: 'Annulation de vente',
  CUSTOMER_RETURN_IN: 'Retour client',
  SUPPLIER_RETURN_OUT: 'Retour fournisseur',
  INVENTORY_ADJUSTMENT: 'Inventaire',
  LOSS: 'Perte',
  BREAKAGE: 'Casse',
  EXPIRED_DESTRUCTION: 'Destruction de périmés',
  CORRECTION: 'Correction',
  RECEIPT_CANCEL: 'Annulation de réception',
});
export type StockMovementType = keyof typeof STOCK_MOVEMENT_TYPES;

export const SUPPLY_SOURCES = labels({
  SUPPLIER: 'Fournisseur',
  DONATION: 'Don',
  TRANSFER: 'Transfert',
  OTHER: 'Autre',
});
export type SupplySource = keyof typeof SUPPLY_SOURCES;

export const LOT_STATUSES = labels({
  ACTIVE: 'Actif',
  BLOCKED: 'Bloqué',
  QUARANTINE: 'Quarantaine',
  EXHAUSTED: 'Épuisé',
});
export type LotStatus = keyof typeof LOT_STATUSES;

export const RECEIPT_STATUSES = labels({
  DRAFT: 'Brouillon',
  VALIDATED: 'Validée',
  CANCELLED: 'Annulée',
});
export type ReceiptStatus = keyof typeof RECEIPT_STATUSES;

export const SALE_STATUSES = labels({
  DRAFT: 'Panier en cours',
  ON_HOLD: 'En attente',
  VALIDATED: 'Validée',
  CANCELLED: 'Annulée',
  DISCARDED: 'Abandonnée',
});
export type SaleStatus = keyof typeof SALE_STATUSES;

export const PAYMENT_STATUSES_OF_SALE = labels({
  UNPAID: 'Non payée',
  PARTIALLY_PAID: 'Partiellement payée',
  PAID: 'Payée',
});
export type SalePaymentStatus = keyof typeof PAYMENT_STATUSES_OF_SALE;

export const RETURN_STATUSES_OF_SALE = labels({
  NONE: 'Aucun retour',
  PARTIALLY_RETURNED: 'Partiellement retournée',
  RETURNED: 'Retournée',
});
export type SaleReturnStatus = keyof typeof RETURN_STATUSES_OF_SALE;

export const SALE_UNITS = labels({ PACK: 'Boîte', UNIT: 'Unité' });
export type SaleUnit = keyof typeof SALE_UNITS;

export const PAYMENT_METHODS = labels({
  CASH: 'Espèces',
  CARD: 'Carte',
  CHEQUE: 'Chèque',
  TRANSFER: 'Virement',
  DRAFT_BILL: 'Traite',
  CREDIT_NOTE: 'Avoir / crédit client',
});
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const PAYMENT_STATUSES = labels({
  VALID: 'Valide',
  CANCELLED: 'Annulé',
  BOUNCED: 'Impayé',
});
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;

export const CHEQUE_STATUSES = labels({
  IN_PORTFOLIO: 'En portefeuille',
  DEPOSITED: 'Remis en banque',
  CASHED: 'Encaissé',
  BOUNCED: 'Impayé',
});
export type ChequeStatus = keyof typeof CHEQUE_STATUSES;

export const CLIENT_TYPES = labels({
  INDIVIDUAL: 'Particulier',
  PHARMACY: 'Pharmacie',
  CLINIC: 'Clinique',
  HOSPITAL: 'Hôpital',
  ASSOCIATION: 'Association',
  COMPANY: 'Entreprise',
  OTHER: 'Autre',
});
export type ClientType = keyof typeof CLIENT_TYPES;

export const PRODUCT_CATEGORY_KINDS = labels({
  MEDICINE: 'Médicament',
  PARAPHARMACY: 'Parapharmacie',
  MEDICAL_DEVICE: 'Dispositif médical',
  OTHER: 'Autre',
});
export type ProductCategoryKind = keyof typeof PRODUCT_CATEGORY_KINDS;

export const CONTROLLED_CLASSES = labels({
  NONE: 'Aucun',
  A: 'Tableau A',
  B: 'Tableau B',
  C: 'Tableau C',
});
export type ControlledClass = keyof typeof CONTROLLED_CLASSES;

export const PRODUCT_FORMS = [
  'Comprimé',
  'Comprimé effervescent',
  'Comprimé pelliculé',
  'Gélule',
  'Sachet',
  'Sirop',
  'Suspension buvable',
  'Solution buvable',
  'Gouttes',
  'Injectable',
  'Pommade',
  'Crème',
  'Gel',
  'Collyre',
  'Suppositoire',
  'Ovule',
  'Spray',
  'Inhalateur',
  'Patch',
  'Poudre',
  'Autre',
] as const;

export const CLIENT_LEDGER_ENTRY_TYPES = labels({
  INVOICE: 'Facture',
  PAYMENT: 'Règlement',
  CREDIT_NOTE: 'Avoir',
  INVOICE_CANCEL: 'Annulation de facture',
  PAYMENT_CANCEL: 'Annulation de règlement',
  REFUND: 'Remboursement',
  ADJUSTMENT: 'Ajustement',
});
export type ClientLedgerEntryType = keyof typeof CLIENT_LEDGER_ENTRY_TYPES;

export const CASH_MOVEMENT_TYPES = labels({
  OPENING_FLOAT: 'Fond de caisse',
  SALE_PAYMENT: 'Encaissement',
  REFUND: 'Remboursement',
  EXPENSE: 'Sortie (dépense)',
  DEPOSIT: 'Apport',
  WITHDRAWAL: 'Retrait',
  DRAWER_OPEN: 'Ouverture du tiroir sans vente',
});
export type CashMovementType = keyof typeof CASH_MOVEMENT_TYPES;

export const ADJUSTMENT_TYPES = labels({
  LOSS: 'Perte',
  BREAKAGE: 'Casse',
  EXPIRED_DESTRUCTION: 'Destruction de périmés',
  CORRECTION: 'Correction',
});
export type AdjustmentType = keyof typeof ADJUSTMENT_TYPES;

export const ADJUSTMENT_STATUSES = labels({
  PENDING: 'En attente de validation',
  VALIDATED: 'Validé',
  REJECTED: 'Rejeté',
});

export const INVENTORY_STATUSES = labels({
  COUNTING: 'Comptage en cours',
  VALIDATED: 'Validé',
  CANCELLED: 'Annulé',
});

export const SUPPLIER_RETURN_STATUSES = labels({
  PENDING_CREDIT: 'En attente d’avoir fournisseur',
  CREDIT_RECEIVED: 'Avoir reçu',
  CANCELLED: 'Annulé',
});

export const DEVICE_STATUSES = labels({
  PENDING: 'En attente d’approbation',
  APPROVED: 'Approuvé',
  REVOKED: 'Révoqué',
});
export type DeviceStatus = keyof typeof DEVICE_STATUSES;

/** Types de documents numérotés (RG-10). */
export const DOCUMENT_TYPES = labels({
  FAC: 'Facture',
  AV: 'Avoir',
  REG: 'Règlement',
  REC: 'Réception',
  RT: 'Retour client',
  RF: 'Retour fournisseur',
  INV: 'Inventaire',
  AJ: 'Ajustement',
  CS: 'Session de caisse',
});
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const EMAIL_STATUSES = labels({
  QUEUED: 'En file',
  SENDING: 'En cours',
  SENT: 'Envoyé',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
});
export type EmailStatus = keyof typeof EMAIL_STATUSES;

export const NOTIFICATION_MODES = labels({
  OFF: 'Désactivé',
  IN_APP: 'Dans le logiciel uniquement',
  EMAIL_IMMEDIATE: 'E-mail immédiat',
  EMAIL_DAILY: 'Résumé quotidien',
  EMAIL_WEEKLY: 'Résumé hebdomadaire',
});
export type NotificationMode = keyof typeof NOTIFICATION_MODES;

export const SEVERITIES = labels({
  INFO: 'Info',
  WARNING: 'Avertissement',
  CRITICAL: 'Critique',
});
export type Severity = keyof typeof SEVERITIES;
