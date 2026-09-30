/**
 * Codes d'erreur métier stables (§3.4) et leur message français par défaut.
 * Format de réponse API : { code, message, details }.
 */
export const ERROR_MESSAGES = {
  // Génériques
  VALIDATION_ERROR: 'Certaines informations saisies sont invalides. Corrigez les champs signalés.',
  NOT_FOUND: 'Élément introuvable. Il a peut-être été supprimé ou vous n’y avez pas accès.',
  CONFLICT: 'Cette opération entre en conflit avec l’état actuel des données.',
  VERSION_CONFLICT:
    'Cet élément a été modifié par un autre utilisateur entre-temps. Rechargez la page pour voir la dernière version.',
  INTERNAL_ERROR: 'Erreur interne du serveur. Réessayez ; si le problème persiste, contactez l’administrateur.',
  RATE_LIMITED: 'Trop de requêtes. Patientez quelques instants puis réessayez.',
  IDEMPOTENCY_CONFLICT: 'Cette opération est déjà en cours de traitement. Patientez un instant.',
  // Authentification / accès
  UNAUTHENTICATED: 'Votre session a expiré. Reconnectez-vous.',
  INVALID_CREDENTIALS: 'Identifiant ou mot de passe incorrect.',
  INVALID_PIN: 'Code utilisateur ou PIN incorrect.',
  ACCOUNT_LOCKED: 'Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard ou contactez un administrateur.',
  ACCOUNT_DISABLED: 'Ce compte est désactivé. Contactez un administrateur.',
  PASSWORD_CHANGE_REQUIRED: 'Vous devez changer votre mot de passe avant de continuer.',
  PASSWORD_POLICY: 'Le mot de passe ne respecte pas la politique de sécurité.',
  TOTP_REQUIRED: 'Saisissez le code de double authentification (application TOTP).',
  TOTP_INVALID: 'Code de double authentification incorrect.',
  SCREEN_LOCKED: 'Écran verrouillé : saisissez votre PIN pour continuer.',
  PIN_NOT_SET: 'Aucun PIN n’est défini pour cet utilisateur.',
  FORBIDDEN: 'Vous n’avez pas la permission d’effectuer cette action.',
  OVERRIDE_REQUIRED: 'Cette action nécessite l’autorisation d’un administrateur (code + PIN).',
  OVERRIDE_INVALID: 'Autorisation refusée : code administrateur ou PIN incorrect, ou droits insuffisants.',
  DEVICE_UNKNOWN: 'Ce poste n’est pas enregistré. Rechargez la page pour l’enregistrer.',
  DEVICE_PENDING: 'Ce poste est en attente d’approbation par un administrateur.',
  DEVICE_REVOKED: 'Ce poste a été révoqué. Contactez un administrateur.',
  SYSTEM_ROLE_PROTECTED: 'Les rôles système ne peuvent pas être supprimés ni renommés.',
  ROLE_IN_USE: 'Ce rôle est attribué à des utilisateurs : réaffectez-les avant de le supprimer.',
  LAST_ADMIN: 'Impossible : il doit rester au moins un administrateur actif.',
  // Catalogue / tiers
  DUPLICATE_CODE: 'Ce code est déjà utilisé.',
  DUPLICATE_BARCODE: 'Ce code-barres est déjà attribué à un autre produit.',
  PRODUCT_INACTIVE: 'Ce produit est archivé.',
  CLIENT_INACTIVE: 'Ce client est désactivé.',
  SUPPLIER_REQUIRED: 'Le fournisseur est obligatoire pour une source « Fournisseur ».',
  REASON_REQUIRED: 'Un motif est obligatoire.',
  // Stock
  STOCK_INSUFFICIENT: 'Stock vendable insuffisant.',
  LOT_EXPIRED: 'Ce lot est périmé : il ne peut pas être vendu.',
  LOT_NOT_SELLABLE: 'Ce lot n’est pas vendable (bloqué, en quarantaine ou épuisé).',
  LOT_NOT_FOUND: 'Lot introuvable pour ce produit.',
  EXPIRY_IN_PAST: 'La date de péremption est déjà passée.',
  RECEIPT_NOT_DRAFT: 'Cette réception n’est plus modifiable.',
  RECEIPT_EMPTY: 'La réception ne contient aucune ligne.',
  RECEIPT_LOTS_CONSUMED:
    'Des unités de cette réception ont déjà été sorties du stock : utilisez un retour fournisseur ou un ajustement.',
  ADJUSTMENT_NOT_PENDING: 'Cet ajustement a déjà été traité.',
  INVENTORY_NOT_OPEN: 'Cet inventaire n’est pas en cours.',
  INVENTORY_ALREADY_OPEN: 'Un inventaire couvrant ces produits est déjà en cours.',
  // Ventes
  CLIENT_REQUIRED: 'L’acheteur est obligatoire : sélectionnez ou créez un client.',
  SALE_NOT_DRAFT: 'Cette vente n’est plus modifiable.',
  SALE_EMPTY: 'Le panier est vide.',
  SALE_NOT_VALIDATED: 'Cette vente n’est pas validée.',
  SALE_ALREADY_CANCELLED: 'Cette vente est déjà annulée.',
  SALE_HAS_RETURNS: 'Cette vente a fait l’objet d’un retour : elle ne peut plus être annulée ni modifiée. Utilisez un retour complémentaire.',
  PAYMENT_MISMATCH: 'Le total des paiements ne correspond pas au montant à régler.',
  PRESCRIPTION_REQUIRED: 'Les informations d’ordonnance sont obligatoires pour ce produit.',
  CREDIT_LIMIT_EXCEEDED: 'Plafond de crédit du client dépassé.',
  CREDIT_NOT_ALLOWED: 'La vente à crédit n’est pas autorisée pour ce client.',
  CREDIT_BALANCE_INSUFFICIENT: 'Crédit disponible (avoir) insuffisant.',
  DISCOUNT_TOO_HIGH: 'Remise supérieure au plafond autorisé.',
  CASH_SESSION_REQUIRED: 'Ouvrez une session de caisse sur ce poste avant d’encaisser des espèces.',
  UNIT_SALE_NOT_ALLOWED: 'La vente à l’unité n’est pas autorisée pour ce produit.',
  PIN_REQUIRED: 'Saisissez votre PIN pour valider la vente.',
  // Retours / règlements
  RETURN_QTY_EXCEEDED: 'Quantité retournée supérieure à la quantité vendue non encore retournée.',
  RETURN_NOT_ALLOWED: 'Ce produit ne peut pas être retourné.',
  RETURN_DELAY_EXCEEDED: 'Délai de retour dépassé.',
  ALLOCATION_EXCEEDS_PAYMENT: 'Le total affecté dépasse le montant disponible.',
  ALLOCATION_EXCEEDS_DUE: 'Le montant affecté dépasse le reste à payer de la facture.',
  PAYMENT_NOT_VALID: 'Ce règlement n’est plus valide.',
  // Caisse
  CASH_SESSION_ALREADY_OPEN: 'Une session de caisse est déjà ouverte sur ce poste.',
  CASH_SESSION_NOT_OPEN: 'Aucune session de caisse ouverte.',
  // E-mail
  EMAIL_DISABLED: 'L’envoi d’e-mails est désactivé ou le serveur SMTP n’est pas configuré.',
  EMAIL_INVALID: 'Adresse e-mail invalide.',
  SMTP_ERROR: 'Erreur de connexion au serveur SMTP.',
  CRITICAL_ALERTS_REQUIRED: 'Au moins un administrateur doit rester abonné par e-mail aux alertes critiques.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ApiErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export function errorMessage(code: string): string {
  return (ERROR_MESSAGES as Record<string, string>)[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}
