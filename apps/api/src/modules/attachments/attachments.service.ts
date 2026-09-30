import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export const ALLOWED_MIME = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Détecte le type réel du fichier (signature), sans se fier au type annoncé par le navigateur. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Pièces jointes (scan de facture fournisseur, logo) stockées sur disque, hors du dossier public. */
@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private root(): string {
    return resolve(loadConfig().STORAGE_DIR, 'attachments');
  }

  async store(
    file: { originalname: string; buffer: Buffer; size: number },
    actor: Actor,
    allowed: string[] = [...ALLOWED_MIME.keys()],
  ) {
    if (!file?.buffer?.length)
      throw new AppError('VALIDATION_ERROR', undefined, { message: 'Fichier manquant.' });
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw new AppError('VALIDATION_ERROR', undefined, {
        message: 'Fichier trop volumineux (8 Mo maximum).',
      });
    const mime = sniffMime(file.buffer);
    if (!mime || !allowed.includes(mime)) {
      throw new AppError('VALIDATION_ERROR', undefined, {
        message: 'Format non accepté : PDF, PNG, JPEG ou WebP uniquement.',
      });
    }
    const at = now();
    const dir = join(
      this.root(),
      String(at.getUTCFullYear()),
      String(at.getUTCMonth() + 1).padStart(2, '0'),
    );
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    const relative = join(
      String(at.getUTCFullYear()),
      String(at.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.${ALLOWED_MIME.get(mime)}`,
    );
    await writeFile(join(this.root(), relative), file.buffer, { mode: 0o640 });
    const filename =
      file.originalname.replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 120) ||
      `fichier.${ALLOWED_MIME.get(mime)}`;
    return this.prisma.attachment.create({
      data: {
        id,
        filename,
        mime,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        storagePath: relative,
        uploadedById: actor.userId,
        createdAt: at,
      },
    });
  }

  async read(id: string): Promise<{ filename: string; mime: string; data: Buffer }> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new AppError('NOT_FOUND');
    const path = resolve(this.root(), attachment.storagePath);
    if (!path.startsWith(this.root())) throw new AppError('NOT_FOUND');
    return { filename: attachment.filename, mime: attachment.mime, data: await readFile(path) };
  }
}
