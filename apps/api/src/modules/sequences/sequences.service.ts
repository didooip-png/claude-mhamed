import { Injectable } from '@nestjs/common';
import { localParts, type DocumentType } from '@pharmastock/shared';
import type { Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Numérotation continue, sans trou, par type et par année (RG-10).
 * Le numéro est attribué dans la transaction de validation : la ligne de séquence est
 * verrouillée (FOR UPDATE) ; si la transaction échoue, l'incrément est annulé avec elle.
 */
@Injectable()
export class SequencesService {
  constructor(private readonly settings: SettingsService) {}

  async next(tx: Tx, docType: DocumentType, at: Date = new Date()): Promise<string> {
    const settings = await this.settings.all(tx);
    const year = Number(localParts(at, settings['general.timezone']).date.slice(0, 4));
    const prefix = settings['numbering.prefixes'][docType] ?? docType;
    await tx.$executeRaw`
      INSERT INTO document_sequences (doc_type, year, prefix, next_number)
      VALUES (${docType}, ${year}, ${prefix}, 1)
      ON CONFLICT (doc_type, year) DO NOTHING`;
    const rows = await tx.$queryRaw<{ next_number: number }[]>`
      SELECT next_number FROM document_sequences
      WHERE doc_type = ${docType} AND year = ${year}
      FOR UPDATE`;
    const current = rows[0]?.next_number ?? 1;
    await tx.$executeRaw`
      UPDATE document_sequences SET next_number = ${current + 1}, prefix = ${prefix}
      WHERE doc_type = ${docType} AND year = ${year}`;
    return `${prefix}-${year}-${String(current).padStart(6, '0')}`;
  }
}
