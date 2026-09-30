import { z } from 'zod';
import { idSchema, isoDateSchema } from './schemas/common.js';

/**
 * Statistiques et rapports (§6.15) : tous les rapports partagent la même forme (tableau +
 * indicateurs + graphique), ce qui permet un affichage, un export Excel et un export PDF communs.
 */

export type ReportColumnType =
  'text' | 'int' | 'qty' | 'money' | 'percent' | 'decimal' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  header: string;
  type: ReportColumnType;
}

export interface ReportKpi {
  key: string;
  label: string;
  type: 'money' | 'int' | 'percent' | 'decimal';
  value: number | null;
  /** Valeur de la période de comparaison. */
  previous?: number | null;
}

export interface ReportChart {
  type: 'line' | 'bar' | 'pie' | 'heatmap';
  /** Colonne des abscisses (ou des catégories). */
  x: string;
  series: { key: string; label: string; type: 'money' | 'int' | 'qty' | 'percent' | 'decimal' }[];
  /** Carte de chaleur : colonne des ordonnées et de la valeur. */
  y?: string;
  value?: string;
}

export type ReportCell = string | number | null;

export interface ReportResult {
  id: ReportId;
  title: string;
  /** Période du rapport (dates locales incluses) ; absente pour un état à date. */
  from: string | null;
  to: string | null;
  comparison: { from: string; to: string; label: string } | null;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  chart: ReportChart | null;
  notes: string[];
}

export const REPORT_GROUPS = {
  sales: 'Ventes',
  margins: 'Marges',
  stock: 'Stock',
  expiry: 'Péremptions et pertes',
  purchases: 'Achats',
  returns: 'Retours et annulations',
  receivables: 'Créances',
  cash: 'Caisse',
  journals: 'Journaux et états réglementaires',
} as const;
export type ReportGroup = keyof typeof REPORT_GROUPS;

interface ReportDefinition {
  group: ReportGroup;
  label: string;
  description: string;
  /** Rapport à une date donnée (pas de période). */
  snapshot?: boolean;
  /** Paramètres supplémentaires attendus. */
  needs?: ('productId' | 'lotNumber' | 'days')[];
}

export const REPORTS = {
  'sales-summary': {
    group: 'sales',
    label: 'Chiffre d’affaires',
    description:
      'CA TTC / HT, nombre de ventes, panier moyen, marge, retours ; comparaison de périodes.',
  },
  'sales-by-user': {
    group: 'sales',
    label: 'Ventes par utilisateur',
    description: 'Nombre de ventes, CA, remises et marge par employé.',
  },
  'sales-by-client': {
    group: 'sales',
    label: 'Ventes par client',
    description: 'Meilleurs clients de la période.',
  },
  'sales-by-category': {
    group: 'sales',
    label: 'Ventes par catégorie',
    description: 'CA et marge par catégorie de produits.',
  },
  'sales-by-laboratory': {
    group: 'sales',
    label: 'Ventes par laboratoire',
    description: 'CA et marge par laboratoire.',
  },
  'sales-by-payment': {
    group: 'sales',
    label: 'Ventes par mode de paiement',
    description: 'Encaissements de la période par mode.',
  },
  'sales-heatmap': {
    group: 'sales',
    label: 'Ventes par heure et jour',
    description: 'Carte de chaleur : affluence et CA par jour de la semaine et par heure.',
  },
  'top-products': {
    group: 'sales',
    label: 'Top produits',
    description: 'Produits les plus vendus (quantité, CA, marge).',
  },
  abc: {
    group: 'sales',
    label: 'Analyse ABC (Pareto)',
    description: 'Classes A (80 % du CA), B (15 %) et C (5 %).',
  },
  'margins-by-product': {
    group: 'margins',
    label: 'Marges par produit',
    description: 'Marge brute sur le coût réel des lots vendus.',
  },
  'margins-by-category': {
    group: 'margins',
    label: 'Marges par catégorie',
    description: 'Marge brute et taux de marge par catégorie.',
  },
  'stock-valuation': {
    group: 'stock',
    label: 'Valeur du stock',
    description: 'Au coût d’achat réel et au prix de vente, par catégorie.',
    snapshot: true,
  },
  'stock-rotation': {
    group: 'stock',
    label: 'Rotation et couverture',
    description: 'Rotation du stock et couverture en jours, par produit.',
  },
  'stock-dormant': {
    group: 'stock',
    label: 'Produits dormants',
    description: 'Produits en stock sans aucune vente depuis N jours.',
    snapshot: true,
    needs: ['days'],
  },
  'expiry-value': {
    group: 'expiry',
    label: 'Lots à risque de péremption',
    description: 'Valeur des lots périmés et proches de la péremption (30 / 60 / 90 jours).',
    snapshot: true,
  },
  'stock-losses': {
    group: 'expiry',
    label: 'Pertes de stock',
    description: 'Périmés détruits, casse, pertes et écarts d’inventaire de la période.',
  },
  'purchases-by-supplier': {
    group: 'purchases',
    label: 'Achats par fournisseur',
    description: 'Montants réceptionnés par fournisseur.',
  },
  'purchases-by-product': {
    group: 'purchases',
    label: 'Achats par produit',
    description: 'Quantités et coût moyen d’achat par produit.',
  },
  'purchase-prices': {
    group: 'purchases',
    label: 'Évolution des prix d’achat',
    description: 'Prix d’achat net d’un produit, réception par réception.',
    needs: ['productId'],
  },
  'returns-by-reason': {
    group: 'returns',
    label: 'Retours clients par motif',
    description: 'Nombre et montant des retours par motif.',
  },
  'returns-by-user': {
    group: 'returns',
    label: 'Retours clients par utilisateur',
    description: 'Retours saisis par chaque employé.',
  },
  'returns-by-product': {
    group: 'returns',
    label: 'Retours clients par produit',
    description: 'Produits les plus retournés, avec leur destination.',
  },
  'cancellations-by-user': {
    group: 'returns',
    label: 'Annulations de ventes par utilisateur',
    description: 'Ventes annulées, montants et motifs, par employé.',
  },
  'receivables-aging': {
    group: 'receivables',
    label: 'Balance âgée',
    description: 'Créances par client selon l’ancienneté des factures.',
    snapshot: true,
  },
  'top-debtors': {
    group: 'receivables',
    label: 'Principaux débiteurs',
    description: 'Clients au solde débiteur le plus élevé.',
    snapshot: true,
  },
  collections: {
    group: 'receivables',
    label: 'Encaissements',
    description: 'Règlements reçus par jour et par mode.',
  },
  'cash-variances': {
    group: 'cash',
    label: 'Écarts de caisse',
    description: 'Écarts constatés à la clôture, par utilisateur et par session.',
  },
  'journal-sales': {
    group: 'journals',
    label: 'Journal des ventes',
    description: 'Toutes les factures de la période.',
  },
  'journal-purchases': {
    group: 'journals',
    label: 'Journal des achats',
    description: 'Toutes les réceptions validées de la période.',
  },
  'journal-payments': {
    group: 'journals',
    label: 'Journal des règlements',
    description: 'Tous les règlements de la période.',
  },
  'vat-summary': {
    group: 'journals',
    label: 'Récapitulatif TVA',
    description: 'TVA collectée par taux (ventes moins avoirs) et TVA déductible (achats).',
  },
  'controlled-register': {
    group: 'journals',
    label: 'Registre des produits à tableau',
    description: 'Date, produit, lot, quantité, client, prescripteur et ordonnance.',
  },
  'lot-trace': {
    group: 'journals',
    label: 'Traçabilité d’un lot',
    description: 'Tous les mouvements d’un numéro de lot, de la réception aux ventes.',
    snapshot: true,
    needs: ['lotNumber'],
  },
} as const satisfies Record<string, ReportDefinition>;

export type ReportId = keyof typeof REPORTS;
export const REPORT_IDS = Object.keys(REPORTS) as [ReportId, ...ReportId[]];

export function isReportId(id: string): id is ReportId {
  return Object.prototype.hasOwnProperty.call(REPORTS, id);
}

export const reportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Comparaison : période précédente de même durée, ou mêmes dates l'année précédente. */
  compare: z.enum(['none', 'previous', 'year']).default('none'),
  granularity: z.enum(['day', 'week', 'month', 'year']).default('day'),
  productId: idSchema.optional(),
  lotNumber: z.string().trim().min(1).max(100).optional(),
  days: z.coerce.number().int().min(7).max(730).optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;
