import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { formatBytes } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { s3PutObject, type S3Config } from './s3.js';

const run = promisify(execFile);
const pad = (n: number) => String(n).padStart(2, '0');

export type BackupTrigger = 'SCHEDULE' | 'MANUAL' | 'PRE_MIGRATION';

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Sauvegardes (§9) : `pg_dump` compressé (format custom), vérifié par `pg_restore --list`,
 * conservé N jours en local, copié hors site sur un stockage compatible S3 si configuré.
 * Un échec est tracé (BACKUP_FAILED, critique) et notifié à l'administrateur.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private s3(): S3Config | null {
    const c = loadConfig();
    if (!c.S3_ENDPOINT || !c.S3_BUCKET || !c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY)
      return null;
    return {
      endpoint: c.S3_ENDPOINT,
      bucket: c.S3_BUCKET,
      region: c.S3_REGION,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
    };
  }

  private dumpArgs(file: string): { args: string[]; env: NodeJS.ProcessEnv } {
    const url = new URL(loadConfig().DATABASE_URL);
    return {
      args: [
        '--format=custom',
        '--compress=9',
        '--no-owner',
        `--host=${url.hostname}`,
        `--port=${url.port || '5432'}`,
        `--username=${decodeURIComponent(url.username)}`,
        `--dbname=${url.pathname.slice(1)}`,
        `--file=${file}`,
      ],
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    };
  }

  directory(): string {
    return resolve(loadConfig().BACKUP_DIR);
  }

  /** Sauvegarde complète ; retourne la ligne de l'historique. */
  async run(trigger: BackupTrigger, actor: Actor | null = null) {
    const config = loadConfig();
    const dir = this.directory();
    await mkdir(dir, { recursive: true });
    const at = now();
    const started = await this.prisma.backup.create({
      data: { status: 'RUNNING', startedAt: at, triggeredById: actor?.userId ?? null },
    });
    const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
    const filename = `pharmastock-${stamp}-${started.id.slice(0, 8)}.dump`;
    const file = join(dir, filename);
    try {
      const { args, env } = this.dumpArgs(file);
      await run(config.PG_DUMP_PATH, args, {
        env,
        timeout: 30 * 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      // Vérification : l'archive doit être lisible et non vide.
      const list = await run(config.PG_RESTORE_PATH, ['--list', file], {
        maxBuffer: 50 * 1024 * 1024,
      });
      const items = list.stdout.split('\n').filter((l) => l && !l.startsWith(';')).length;
      if (items < 5) throw new Error('Archive de sauvegarde vide ou illisible.');
      const size = (await stat(file)).size;
      const sha256 = await sha256File(file);
      const offsite = await this.copyOffsite(file, filename, sha256);
      const purged = await this.purge(dir);
      const done = await this.prisma.backup.update({
        where: { id: started.id },
        data: {
          status: 'SUCCESS',
          finishedAt: now(),
          filename,
          sizeBytes: BigInt(size),
          offsiteStatus: offsite,
        },
      });
      await this.audit.recordStandalone({
        eventType: 'BACKUP_CREATED',
        actor,
        entityType: 'backup',
        entityId: started.id,
        entityRef: filename,
        summary: `Sauvegarde ${filename} : ${formatBytes(size)}, ${items} objets${offsite ? ` — copie hors site : ${offsite}` : ''}${purged > 0 ? ` — ${purged} ancienne(s) supprimée(s)` : ''}`,
        metadata: { trigger, sha256, items, offsite, purged },
        notify: false,
      });
      return done;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, 'Sauvegarde en échec');
      await unlink(file).catch(() => undefined);
      await this.prisma.backup.update({
        where: { id: started.id },
        data: { status: 'FAILED', finishedAt: now(), error: message.slice(0, 1000) },
      });
      await this.audit.recordStandalone({
        eventType: 'BACKUP_FAILED',
        actor,
        entityType: 'backup',
        entityId: started.id,
        summary: `Sauvegarde échouée : ${message.slice(0, 300)}`,
        metadata: { trigger },
        notify: { link: '/admin/backups' },
      });
      throw new AppError('INTERNAL_ERROR', undefined, {
        message: `La sauvegarde a échoué : ${message.slice(0, 200)}`,
      });
    }
  }

  private async copyOffsite(
    file: string,
    filename: string,
    sha256: string,
  ): Promise<string | null> {
    const s3 = this.s3();
    if (!s3) return null;
    try {
      await s3PutObject(s3, `backups/${filename}`, await readFile(file), sha256);
      return 'Copiée';
    } catch (err) {
      this.logger.error({ err }, 'Copie hors site en échec');
      return `Échec : ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
    }
  }

  /** Supprime les archives locales plus anciennes que la durée de rétention. */
  private async purge(dir: string): Promise<number> {
    const limit = new Date(now().getTime() - loadConfig().BACKUP_RETENTION_DAYS * 86_400_000);
    const old = await this.prisma.backup.findMany({
      where: { status: 'SUCCESS', filename: { not: null }, startedAt: { lt: limit } },
    });
    let count = 0;
    for (const b of old) {
      await unlink(join(dir, basename(b.filename!))).catch(() => undefined);
      await this.prisma.backup.update({ where: { id: b.id }, data: { filename: null } });
      count += 1;
    }
    return count;
  }

  async list() {
    const rows = await this.prisma.backup.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.triggeredById).filter((x): x is string => !!x) } },
      select: { id: true, code: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.code]));
    const s3 = this.s3();
    return {
      offsiteConfigured: !!s3,
      retentionDays: loadConfig().BACKUP_RETENTION_DAYS,
      items: rows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        status: r.status,
        filename: r.filename,
        sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
        offsiteStatus: r.offsiteStatus,
        error: r.error,
        triggeredBy: r.triggeredById ? (byId.get(r.triggeredById) ?? null) : 'Planifiée',
      })),
    };
  }

  /** Chemin d'une archive à télécharger (jamais de chemin fourni par l'utilisateur). */
  async fileOf(id: string): Promise<{ path: string; filename: string }> {
    const row = await this.prisma.backup.findUnique({ where: { id } });
    if (!row || row.status !== 'SUCCESS' || !row.filename)
      throw new AppError('NOT_FOUND', undefined, {
        message: 'Cette sauvegarde n’est plus disponible localement.',
      });
    return {
      path: join(this.directory(), basename(row.filename)),
      filename: basename(row.filename),
    };
  }
}
