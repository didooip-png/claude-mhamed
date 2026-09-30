import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext, type Session } from './helpers.js';

const t = new TestContext();
let admin: Session & { code: string };

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
});
afterAll(() => t.stop());

describe('revue de sécurité (§ Phase 6)', () => {
  it('en-têtes de sécurité de l’API, sans trace de la technologie', async () => {
    const res = await t.http.get('/api/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('une route inconnue ou une erreur ne révèle ni pile d’appels ni chemin de fichier', async () => {
    const unknown = await t.get('/nope/nope', admin).expect(404);
    expect(JSON.stringify(unknown.body)).not.toMatch(/node_modules|\.ts:|at\s+\w+\s+\(/);
    const bad = await t.get('/products/pas-un-uuid', admin);
    expect(bad.status).toBeLessThan(500);
    expect(JSON.stringify(bad.body)).not.toMatch(/node_modules|\.ts:|prisma|SELECT /i);
  });

  it('refuse un corps JSON de plus de 2 Mo', async () => {
    const res = await t.http
      .post('/api/v1/auth/login')
      .set(t.headers())
      .send({ username: 'x'.repeat(3 * 1024 * 1024), password: 'y' });
    expect(res.status).toBe(413);
  });

  it('le cookie de rafraîchissement est HttpOnly, SameSite=Strict et limité à /auth', async () => {
    const user = await t.createUser({ role: 'PREPARER' });
    const res = await t.http
      .post('/api/v1/auth/login')
      .set(t.headers())
      .send({ username: user.username, password: 'Motdepasse1' })
      .expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
    // Le jeton d'accès n'est jamais posé en cookie : uniquement dans la réponse JSON.
    expect(res.headers['set-cookie']).toHaveLength(1);
  });

  it('les saisies hostiles restent inertes (injection SQL, HTML, caractères de contrôle)', async () => {
    const hostile = [
      "'; DROP TABLE products; --",
      '<script>alert(1)</script>',
      '%_\\',
      '\u0000\u0007',
      '" OR 1=1 --',
    ];
    for (const q of hostile) {
      const res = await t.get(`/products/search?q=${encodeURIComponent(q)}`, admin);
      expect(res.status, q).toBeLessThan(500);
      const list = await t.get(`/products?q=${encodeURIComponent(q)}`, admin);
      expect(list.status, q).toBeLessThan(500);
      const clients = await t.get(`/clients?q=${encodeURIComponent(q)}`, admin);
      expect(clients.status, q).toBeLessThan(500);
    }
    // La table existe toujours.
    expect(await t.prisma.product.count()).toBeGreaterThanOrEqual(0);
  });

  it('les pièces jointes sont typées par leur contenu, jamais par leur nom ni leur type déclaré', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const spoof = await t.http
      .post('/api/v1/attachments')
      .set(t.auth(admin))
      .attach('file', html, { filename: 'facture.pdf', contentType: 'application/pdf' });
    expect(spoof.status).toBeGreaterThanOrEqual(400);
    expect(spoof.status).toBeLessThan(500);
    const exe = await t.http
      .post('/api/v1/attachments')
      .set(t.auth(admin))
      .attach('file', Buffer.from('MZ\x90\x00\x03'), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
    expect(exe.status).toBeGreaterThanOrEqual(400);
    expect(exe.status).toBeLessThan(500);
  });

  it('une pièce jointe valide est servie avec nosniff et jamais comme HTML', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await t.http
      .post('/api/v1/attachments')
      .set(t.auth(admin))
      .attach('file', png, { filename: '<img onerror=x>.png', contentType: 'image/png' })
      .expect(201);
    const res = await t.get(`/attachments/${up.body.id}`, admin).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('les secrets ne sortent jamais dans les réponses de configuration', async () => {
    await t
      .put('/email/smtp', admin, {
        enabled: false,
        host: 'smtp.example.com',
        port: 587,
        security: 'STARTTLS',
        username: 'compte',
        password: 'mot-de-passe-secret-42',
        fromName: 'Pharmacie',
        fromEmail: 'a@example.com',
        replyTo: '',
        bccArchive: '',
        hourlyLimit: 100,
      })
      .expect(200);
    const res = await t.get('/email/smtp', admin).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('mot-de-passe-secret-42');
    const audit = await t.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 20 });
    expect(
      JSON.stringify(audit, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toContain('mot-de-passe-secret-42');
  });
});
