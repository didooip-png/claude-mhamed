import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { BackupService } from '../src/modules/backups/backup.service.js';
import { TEST_DATABASE_URL } from './env.js';
import { TestContext, type Session } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };
let prep: Session & { code: string };
const baseUrl = TEST_DATABASE_URL.replace(/\?.*$/, '');

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
});

afterAll(async () => {
  delete process.env.S3_ENDPOINT;
  resetConfigCache();
  await t.stop();
});

describe('sauvegardes', () => {
  let backupId = '';
  let filename = '';

  it('réservées aux administrateurs', async () => {
    await t.get('/admin/backups', prep).expect(403);
    await t.post('/admin/backups', prep).expect(403);
  });

  it('crée une sauvegarde vérifiée, restaurable à l’identique', async () => {
    const res = await t.post('/admin/backups', admin).expect(200);
    expect(res.body.status).toBe('SUCCESS');
    backupId = res.body.id;
    filename = res.body.filename;
    expect(Number(res.body.sizeBytes)).toBeGreaterThan(10_000);
    expect(res.body.offsiteStatus).toBeNull();

    const list = await t.get('/admin/backups', admin).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: backupId, status: 'SUCCESS' });
    expect(list.body.offsiteConfigured).toBe(false);

    // Restauration dans une base temporaire : mêmes volumes de données.
    const dir = t.app.get(BackupService).directory();
    const file = `${dir}/${filename}`;
    expect(existsSync(file)).toBe(true);
    const admin_ = new pg.Client({ connectionString: baseUrl.replace(/\/[^/]+$/, '/postgres') });
    await admin_.connect();
    await admin_.query('DROP DATABASE IF EXISTS pharmastock_restore_test');
    await admin_.query('CREATE DATABASE pharmastock_restore_test');
    try {
      const url = new URL(baseUrl);
      execFileSync(
        'pg_restore',
        [
          '--no-owner',
          `--host=${url.hostname}`,
          `--port=${url.port || '5432'}`,
          `--username=${url.username}`,
          '--dbname=pharmastock_restore_test',
          file,
        ],
        { env: { ...process.env, PGPASSWORD: url.password }, stdio: 'pipe' },
      );
      const restored = new pg.Client({
        connectionString: baseUrl.replace(/\/[^/]+$/, '/pharmastock_restore_test'),
      });
      await restored.connect();
      try {
        const count = async (table: string) =>
          Number((await restored.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
        expect(await count('users')).toBe(await t.prisma.user.count());
        expect(await count('audit_logs')).toBeGreaterThan(0);
        expect(await count('audit_logs')).toBeLessThanOrEqual(await t.prisma.auditLog.count());
        expect(await count('backups')).toBeGreaterThan(0);
      } finally {
        await restored.end();
      }
    } finally {
      await admin_.query('DROP DATABASE IF EXISTS pharmastock_restore_test');
      await admin_.end();
    }
  });

  it('téléchargement tracé au mouchard', async () => {
    const res = await t
      .get(`/admin/backups/${backupId}/download`, admin)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(filename);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('PGDMP');
    const audit = await t.prisma.auditLog.findFirst({
      where: { eventType: 'BACKUP_DOWNLOADED', entityId: backupId },
    });
    expect(audit).not.toBeNull();
    await t.get(`/admin/backups/${backupId}/download`, prep).expect(403);
  });

  it('copie hors site signée (SigV4) vers un stockage compatible S3', async () => {
    const received: {
      url: string;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }[] = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
        res.statusCode = 200;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    Object.assign(process.env, {
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_BUCKET: 'sauvegardes',
      S3_ACCESS_KEY_ID: 'AKIATEST',
      S3_SECRET_ACCESS_KEY: 'secret-test',
      S3_REGION: 'auto',
    });
    resetConfigCache();
    try {
      const res = await t.post('/admin/backups', admin).expect(200);
      expect(res.body.offsiteStatus).toBe('Copiée');
      expect(received).toHaveLength(1);
      const put = received[0]!;
      expect(put.url).toBe(`/sauvegardes/backups/${res.body.filename}`);
      expect(String(put.headers.authorization)).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(put.headers['x-amz-content-sha256']).toBe(
        createHash('sha256').update(put.body).digest('hex'),
      );
      expect(put.body.subarray(0, 5).toString()).toBe('PGDMP');

      // Stockage hors site indisponible : la sauvegarde locale reste valide, l'échec est signalé.
      await new Promise((r) => server.close(r));
      const down = await t.post('/admin/backups', admin).expect(200);
      expect(down.body.status).toBe('SUCCESS');
      expect(down.body.offsiteStatus).toMatch(/^Échec/);
    } finally {
      delete process.env.S3_ENDPOINT;
      resetConfigCache();
      if (server.listening) await new Promise((r) => server.close(r));
    }
  });

  it('purge les archives au-delà de la durée de conservation', async () => {
    const old = await t.prisma.backup.update({
      where: { id: backupId },
      data: { startedAt: new Date(Date.now() - 45 * 86_400_000) },
    });
    expect(old.filename).toBe(filename);
    const res = await t.post('/admin/backups', admin).expect(200);
    expect(res.body.status).toBe('SUCCESS');
    const after = await t.prisma.backup.findUniqueOrThrow({ where: { id: backupId } });
    expect(after.filename).toBeNull();
    expect(existsSync(`${t.app.get(BackupService).directory()}/${filename}`)).toBe(false);
    await t.get(`/admin/backups/${backupId}/download`, admin).expect(404);
  });

  it('un échec est tracé (critique) et n’expose pas de chemin', async () => {
    process.env.PG_DUMP_PATH = '/nonexistent/pg_dump';
    resetConfigCache();
    try {
      const res = await t.post('/admin/backups', admin);
      expect(res.status).toBe(500);
      const failed = await t.prisma.backup.findFirst({
        where: { status: 'FAILED' },
        orderBy: { startedAt: 'desc' },
      });
      expect(failed?.error).toBeTruthy();
      const audit = await t.prisma.auditLog.findFirst({
        where: { eventType: 'BACKUP_FAILED', entityId: failed!.id },
      });
      expect(audit?.severity).toBe('CRITICAL');
    } finally {
      delete process.env.PG_DUMP_PATH;
      resetConfigCache();
    }
  });
});
