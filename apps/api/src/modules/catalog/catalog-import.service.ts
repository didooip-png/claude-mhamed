import { Injectable } from '@nestjs/common';
import {
  CONTROLLED_CLASSES,
  parseMoney,
  productSchema,
  type ProductData,
} from '@pharmastock/shared';
import ExcelJS from 'exceljs';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { zodIssuesToDetails } from '../../common/zod.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProductsService } from './products.service.js';

/** Colonnes du fichier d'import / export du catalogue (en-têtes en français). */
export const CATALOG_COLUMNS = [
  { key: 'code', header: 'Code', width: 12 },
  { key: 'nom', header: 'Nom commercial', width: 34 },
  { key: 'dci', header: 'DCI', width: 24 },
  { key: 'dosage', header: 'Dosage', width: 12 },
  { key: 'forme', header: 'Forme', width: 16 },
  { key: 'presentation', header: 'Présentation', width: 18 },
  { key: 'laboratoire', header: 'Laboratoire', width: 20 },
  { key: 'categorie', header: 'Catégorie', width: 18 },
  { key: 'tva', header: 'TVA (%)', width: 9 },
  { key: 'prix_achat_ht', header: 'Prix achat HT', width: 14 },
  { key: 'prix_vente_ttc', header: 'Prix vente TTC', width: 14 },
  { key: 'unites_par_boite', header: 'Unités par boîte', width: 10 },
  { key: 'vente_unite', header: 'Vente à l’unité', width: 10 },
  { key: 'prix_unitaire_ttc', header: 'Prix unitaire TTC', width: 14 },
  { key: 'ordonnance', header: 'Ordonnance', width: 11 },
  { key: 'tableau', header: 'Tableau (A/B/C)', width: 10 },
  { key: 'chaine_froid', header: 'Chaîne du froid', width: 10 },
  { key: 'retournable', header: 'Retour autorisé', width: 10 },
  { key: 'emplacement', header: 'Emplacement', width: 14 },
  { key: 'stock_min', header: 'Stock min', width: 9 },
  { key: 'stock_max', header: 'Stock max', width: 9 },
  { key: 'point_commande', header: 'Point de commande', width: 10 },
  { key: 'codes_barres', header: 'Codes-barres (séparés par ;)', width: 30 },
  { key: 'actif', header: 'Actif', width: 7 },
] as const;

type ColumnKey = (typeof CATALOG_COLUMNS)[number]['key'];

export interface ImportLineReport {
  line: number;
  code: string | null;
  name: string | null;
  action: 'CREATE' | 'UPDATE' | 'ERROR';
  errors: string[];
}

export interface ImportReport {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: number;
  createdReferences: string[];
  lines: ImportLineReport[];
}

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value)
      return value.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function toBool(v: string, fallback: boolean): boolean {
  if (!v) return fallback;
  return ['oui', 'o', 'yes', 'y', '1', 'x', 'vrai', 'true'].includes(v.toLowerCase());
}

function toMoney(v: string): number | null {
  if (!v) return null;
  if (/^-?\d+(\.\d+)?$/.test(v) && v.includes('.') && v.split('.')[1]!.length > 3)
    return Math.round(Number(v) * 1000);
  return parseMoney(v);
}

function toInt(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isInteger(n) ? n : null;
}

@Injectable()
export class CatalogImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  /** Lit un fichier Excel (.xlsx) ou CSV (séparateur ; ou ,) en lignes clé → texte. */
  async readRows(
    buffer: Buffer,
    filename: string,
  ): Promise<{ line: number; values: Record<ColumnKey, string> }[]> {
    const wb = new ExcelJS.Workbook();
    const isCsv = filename.toLowerCase().endsWith('.csv');
    let sheet: ExcelJS.Worksheet | undefined;
    if (isCsv) {
      const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
      const firstLine = text.split(/\r?\n/)[0] ?? '';
      const delimiter =
        (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
      sheet = wb.addWorksheet('import');
      for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        sheet.addRow(parseCsvLine(rawLine, delimiter));
      }
    } else {
      try {
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      } catch {
        throw new AppError('VALIDATION_ERROR', undefined, {
          message: 'Fichier illisible : utilisez un fichier Excel (.xlsx) ou CSV.',
        });
      }
      sheet = wb.worksheets[0];
    }
    if (!sheet || sheet.rowCount < 2)
      throw new AppError('VALIDATION_ERROR', undefined, {
        message: 'Le fichier ne contient aucune ligne de données.',
      });

    const headerRow = sheet.getRow(1);
    const mapping = new Map<number, ColumnKey>();
    headerRow.eachCell((cell, col) => {
      const h = normalizeHeader(cellText(cell.value));
      const match = CATALOG_COLUMNS.find(
        (c) => normalizeHeader(c.header) === h || c.key.replace(/_/g, ' ') === h,
      );
      if (match) mapping.set(col, match.key);
    });
    if (![...mapping.values()].includes('nom')) {
      throw new AppError('VALIDATION_ERROR', undefined, {
        message:
          'Colonne « Nom commercial » introuvable : utilisez le modèle d’export du catalogue.',
      });
    }
    const rows: { line: number; values: Record<ColumnKey, string> }[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const values = Object.fromEntries(CATALOG_COLUMNS.map((c) => [c.key, ''])) as Record<
        ColumnKey,
        string
      >;
      mapping.forEach((key, col) => {
        values[key] = cellText(row.getCell(col).value);
      });
      if (Object.values(values).some((v) => v !== '')) rows.push({ line: index, values });
    });
    if (rows.length > 20_000)
      throw new AppError('VALIDATION_ERROR', undefined, {
        message: 'Fichier trop volumineux (20 000 lignes maximum).',
      });
    return rows;
  }

  async import(
    buffer: Buffer,
    filename: string,
    dryRun: boolean,
    actor: Actor,
  ): Promise<ImportReport> {
    const rows = await this.readRows(buffer, filename);
    const run = async (tx: Tx): Promise<ImportReport> => {
      const createdReferences: string[] = [];
      const labs = new Map(
        (await tx.laboratory.findMany()).map((l) => [l.name.toLowerCase(), l.id]),
      );
      const categories = new Map(
        (await tx.category.findMany()).map((c) => [c.name.toLowerCase(), c.id]),
      );
      const tvaRates = await tx.tvaRate.findMany({ where: { isActive: true } });
      const defaultCategory = (await tx.category.findFirst({ orderBy: { createdAt: 'asc' } }))?.id;
      const report: ImportReport = {
        dryRun,
        total: rows.length,
        created: 0,
        updated: 0,
        errors: 0,
        createdReferences,
        lines: [],
      };
      const seenCodes = new Set<string>();

      for (const { line, values } of rows) {
        const errors: string[] = [];
        const code = values.code ? values.code.toUpperCase() : null;
        if (code && seenCodes.has(code))
          errors.push(`Code ${code} présent plusieurs fois dans le fichier`);
        if (code) seenCodes.add(code);

        let laboratoryId: string | null = null;
        if (values.laboratoire) {
          laboratoryId = labs.get(values.laboratoire.toLowerCase()) ?? null;
          if (!laboratoryId) {
            if (dryRun) laboratoryId = '00000000-0000-4000-8000-000000000000';
            else {
              const lab = await tx.laboratory.create({ data: { name: values.laboratoire } });
              laboratoryId = lab.id;
            }
            labs.set(values.laboratoire.toLowerCase(), laboratoryId);
            createdReferences.push(`Laboratoire « ${values.laboratoire} »`);
          }
        }
        let categoryId: string | null = defaultCategory ?? null;
        if (values.categorie) {
          categoryId = categories.get(values.categorie.toLowerCase()) ?? null;
          if (!categoryId) {
            if (dryRun) categoryId = '00000000-0000-4000-8000-000000000001';
            else {
              const cat = await tx.category.create({
                data: { name: values.categorie, kind: 'MEDICINE' },
              });
              categoryId = cat.id;
            }
            categories.set(values.categorie.toLowerCase(), categoryId);
            createdReferences.push(`Catégorie « ${values.categorie} »`);
          }
        }
        if (!categoryId) errors.push('Catégorie obligatoire');
        const tvaPct = values.tva
          ? Number(values.tva.replace('%', '').replace(',', '.').trim())
          : 7;
        const tva = tvaRates.find((t) => t.rateBp === Math.round(tvaPct * 100));
        if (!tva) errors.push(`Taux de TVA ${values.tva || '7'} % inconnu`);

        const salePrice = toMoney(values.prix_vente_ttc);
        if (salePrice === null) errors.push('Prix de vente TTC invalide ou manquant');
        const purchase = values.prix_achat_ht ? toMoney(values.prix_achat_ht) : 0;
        if (purchase === null) errors.push('Prix d’achat HT invalide');
        const controlled =
          (values.tableau || 'NONE').toUpperCase().replace('TABLEAU', '').trim() || 'NONE';
        if (!(controlled in CONTROLLED_CLASSES)) errors.push('Tableau invalide (A, B, C ou vide)');

        const candidate = {
          internalCode: code ?? undefined,
          name: values.nom,
          dci: values.dci || null,
          dosage: values.dosage || null,
          form: values.forme || null,
          presentation: values.presentation || null,
          laboratoryId,
          categoryId: categoryId ?? '',
          therapeuticClassId: null,
          tvaRateId: tva?.id ?? '',
          refPurchasePriceHt: purchase ?? 0,
          salePriceTtc: salePrice ?? 0,
          unitsPerPack: toInt(values.unites_par_boite) ?? 1,
          sellByUnit: toBool(values.vente_unite, false),
          unitSalePriceTtc: toMoney(values.prix_unitaire_ttc),
          requiresPrescription: toBool(values.ordonnance, false),
          controlledClass: controlled,
          coldChain: toBool(values.chaine_froid, false),
          returnable: toBool(values.retournable, true),
          location: values.emplacement || null,
          minStock: toInt(values.stock_min) ?? 0,
          maxStock: toInt(values.stock_max),
          reorderPoint: toInt(values.point_commande),
          barcodes: values.codes_barres
            ? values.codes_barres
                .split(/[;|\s]+/)
                .map((b) => b.trim())
                .filter(Boolean)
            : [],
          isActive: toBool(values.actif, true),
        };
        let data: ProductData | null = null;
        if (errors.length === 0) {
          const parsed = productSchema.safeParse(candidate);
          if (parsed.success) data = parsed.data;
          else
            errors.push(
              ...Object.entries(
                zodIssuesToDetails(parsed.error).fieldErrors as Record<string, string>,
              ).map(([f, m]) => `${f} : ${m}`),
            );
        }
        const existing = code
          ? await tx.product.findUnique({ where: { internalCode: code } })
          : null;
        if (data && errors.length === 0 && !dryRun) {
          try {
            if (existing)
              await this.products.update(existing.id, { ...data, version: undefined }, actor, tx);
            else await this.products.create(data, actor, tx);
          } catch (err) {
            errors.push(
              err instanceof AppError
                ? (Object.values((err.details?.fieldErrors as Record<string, string>) ?? {})[0] ??
                    err.message)
                : 'Erreur inattendue',
            );
          }
        }
        const action: ImportLineReport['action'] =
          errors.length > 0 ? 'ERROR' : existing ? 'UPDATE' : 'CREATE';
        if (action === 'ERROR') report.errors += 1;
        else if (action === 'UPDATE') report.updated += 1;
        else report.created += 1;
        report.lines.push({ line, code, name: values.nom || null, action, errors });
      }
      if (!dryRun) {
        await this.audit.record(tx, {
          eventType: 'CATALOG_IMPORTED',
          actor,
          entityType: 'catalog',
          summary: `Import du catalogue « ${filename} » : ${report.created} créé(s), ${report.updated} mis à jour, ${report.errors} en erreur`,
          metadata: {
            filename,
            created: report.created,
            updated: report.updated,
            errors: report.errors,
          },
          notify: false,
        });
      }
      return report;
    };
    // Mode test : aucune écriture. Import réel : une seule transaction (les lignes en erreur sont ignorées).
    return dryRun ? run(this.prisma as unknown as Tx) : this.prisma.tx(run, { timeout: 300_000 });
  }

  /** Export Excel du catalogue (même format que l'import). */
  async export(actor: Actor): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      orderBy: { name: 'asc' },
      include: { barcodes: true, laboratory: true, category: true, tvaRate: true },
    });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PharmaStock';
    const ws = wb.addWorksheet('Catalogue', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = CATALOG_COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    const showCosts = actor.permissions.has('catalog.view_costs');
    const money = (v: bigint | null) => (v === null ? '' : Number(v) / 1000);
    for (const p of products) {
      ws.addRow({
        code: p.internalCode,
        nom: p.name,
        dci: p.dci ?? '',
        dosage: p.dosage ?? '',
        forme: p.form ?? '',
        presentation: p.presentation ?? '',
        laboratoire: p.laboratory?.name ?? '',
        categorie: p.category.name,
        tva: p.tvaRate.rateBp / 100,
        prix_achat_ht: showCosts ? money(p.refPurchasePriceHt) : '',
        prix_vente_ttc: money(p.salePriceTtc),
        unites_par_boite: p.unitsPerPack,
        vente_unite: p.sellByUnit ? 'oui' : 'non',
        prix_unitaire_ttc: money(p.unitSalePriceTtc),
        ordonnance: p.requiresPrescription ? 'oui' : 'non',
        tableau: p.controlledClass === 'NONE' ? '' : p.controlledClass,
        chaine_froid: p.coldChain ? 'oui' : 'non',
        retournable: p.returnable ? 'oui' : 'non',
        emplacement: p.location ?? '',
        stock_min: p.minStock,
        stock_max: p.maxStock ?? '',
        point_commande: p.reorderPoint ?? '',
        codes_barres: p.barcodes.map((b) => b.barcode).join(';'),
        actif: p.isActive ? 'oui' : 'non',
      });
    }
    ['prix_achat_ht', 'prix_vente_ttc', 'prix_unitaire_ttc'].forEach((k) => {
      ws.getColumn(k).numFmt = '#,##0.000';
    });
    await this.audit.recordStandalone({
      eventType: 'DATA_EXPORTED',
      actor,
      entityType: 'catalog',
      summary: `Export du catalogue (${products.length} produits)`,
      notify: false,
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}
