import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { TestContext } from './helpers.js';

const t = new TestContext();

beforeAll(() => t.start());
afterAll(() => t.stop());

describe('Authentification et postes', () => {
  it('refuse une requête sans poste enregistré', async () => {
    const res = await t.http.post('/api/v1/auth/login').send({ username: 'x', password: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEVICE_UNKNOWN');
  });

  it('connecte un utilisateur, trace la connexion et renvoie ses permissions', async () => {
    const user = await t.createUser({ role: 'PREPARER' });
    const session = await t.login(user.username);
    const me = await t.get('/auth/me', session).expect(200);
    expect(me.body.code).toBe(user.code);
    expect(me.body.permissions).toContain('sales.create');
    expect(me.body.permissions).not.toContain('sales.cancel');
    const log = await t.prisma.auditLog.findFirst({
      where: { eventType: 'LOGIN_SUCCESS', userId: user.id },
    });
    expect(log?.deviceId).toBe(t.device.id);
    expect(session.cookie).toContain('ps_refresh=');
  });

  it('verrouille le compte après 5 échecs', async () => {
    const user = await t.createUser({ role: 'PREPARER' });
    for (let i = 0; i < 5; i += 1) {
      const res = await t.http
        .post('/api/v1/auth/login')
        .set(t.headers())
        .send({ username: user.username, password: 'mauvais1' });
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await t.http
      .post('/api/v1/auth/login')
      .set(t.headers())
      .send({ username: user.username, password: 'Motdepasse1' });
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(
      await t.prisma.auditLog.count({ where: { eventType: 'ACCOUNT_LOCKED', userId: user.id } }),
    ).toBe(1);
  });

  it('fait tourner le refresh token et détecte sa réutilisation', async () => {
    const user = await t.createUser({ role: 'PREPARER' });
    const session = await t.login(user.username);
    const first = await t.http
      .post('/api/v1/auth/refresh')
      .set(t.headers())
      .set('Cookie', session.cookie)
      .expect(200);
    const newCookie = (first.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(newCookie).not.toBe(session.cookie);
    await t.http.post('/api/v1/auth/refresh').set(t.headers()).set('Cookie', newCookie).expect(200);
    // L'ancien jeton rejoué hors délai de grâce → session révoquée.
    await t.prisma.session.updateMany({
      where: { userId: user.id },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });
    const replay = await t.http
      .post('/api/v1/auth/refresh')
      .set(t.headers())
      .set('Cookie', newCookie);
    expect(replay.status).toBe(401);
    const s = await t.prisma.session.findFirst({ where: { userId: user.id } });
    expect(s?.revokedAt).not.toBeNull();
  });

  it('refuse la connexion depuis un poste en attente, sauf amorçage', async () => {
    await t.prisma.setting.upsert({
      where: { key: 'security.require_device_approval' },
      create: { key: 'security.require_device_approval', value: true },
      update: { value: true },
    });
    t.app.get(SettingsService).invalidate();
    try {
      const pending = await t.registerDevice('Réserve', false);
      const prep = await t.createUser({ role: 'PREPARER' });
      const res = await t.http
        .post('/api/v1/auth/login')
        .set(t.headers(pending))
        .send({ username: prep.username, password: 'Motdepasse1' });
      expect(res.body.code).toBe('DEVICE_PENDING');
    } finally {
      await t.prisma.setting.delete({ where: { key: 'security.require_device_approval' } });
      t.app.get(SettingsService).invalidate();
    }
  });

  it('change rapidement d’utilisateur avec un PIN et verrouille / déverrouille l’écran', async () => {
    const a = await t.as('PREPARER');
    const b = await t.createUser({ role: 'PREPARER', pin: '4321' });
    const switched = await t
      .post('/auth/switch-user', a, { userCode: b.code, pin: '4321' })
      .expect(200);
    expect(switched.body.user.code).toBe(b.code);
    // L'ancienne session est révoquée.
    const old = await t.get('/auth/me', a);
    expect(old.status).toBe(401);

    const bSession = {
      token: switched.body.accessToken as string,
      cookie: (switched.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
      device: t.device,
      userId: b.id,
    };
    await t.post('/auth/lock', bSession).expect(204);
    const locked = await t.get('/auth/me', bSession);
    expect(locked.body.code).toBe('SCREEN_LOCKED');
    const refresh = await t.http
      .post('/api/v1/auth/refresh')
      .set(t.headers())
      .set('Cookie', bSession.cookie);
    expect(refresh.body.code).toBe('SCREEN_LOCKED');
    const bad = await t.http
      .post('/api/v1/auth/unlock')
      .set(t.headers())
      .set('Cookie', bSession.cookie)
      .send({ pin: '0000' });
    expect(bad.body.code).toBe('INVALID_PIN');
    const ok = await t.http
      .post('/api/v1/auth/unlock')
      .set(t.headers())
      .set('Cookie', bSession.cookie)
      .send({ pin: '4321' })
      .expect(200);
    await t.get('/auth/me', { ...bSession, token: ok.body.accessToken }).expect(200);
  });

  it('impose le changement de mot de passe à la première connexion', async () => {
    const user = await t.createUser({ role: 'PREPARER', mustChangePassword: true });
    const session = await t.login(user.username);
    const blocked = await t.get('/users/directory', session);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const weak = await t.post('/auth/change-password', session, {
      currentPassword: 'Motdepasse1',
      newPassword: 'abcdefgh',
    });
    expect(weak.body.code).toBe('PASSWORD_POLICY');
    await t
      .post('/auth/change-password', session, {
        currentPassword: 'Motdepasse1',
        newPassword: 'Nouveau2026',
      })
      .expect(200);
    await t.get('/users/directory', session).expect(200);
  });
});

describe('Permissions (matrice §5.2)', () => {
  it('interdit les écrans d’administration au préparateur (403)', async () => {
    const prep = await t.as('PREPARER');
    for (const path of ['/users', '/roles', '/devices', '/settings', '/audit', '/auth/sessions']) {
      const res = await t.get(path, prep);
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });

  it('autorise l’administrateur et trace la modification d’un paramètre', async () => {
    const admin = await t.as('ADMIN');
    await t.get('/users', admin).expect(200);
    const res = await t
      .put('/settings', admin, { values: { 'sales.preparer_max_discount_bp': 700 } })
      .expect(200);
    expect(res.body['sales.preparer_max_discount_bp']).toBe(700);
    const log = await t.prisma.auditLog.findFirst({
      where: { eventType: 'SETTING_CHANGED', entityId: 'sales.preparer_max_discount_bp' },
    });
    expect(log?.after).toEqual({ value: 700 });
    const invalid = await t.put('/settings', admin, { values: { 'stock.exit_rule': 'LIFO' } });
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('empêche de désactiver le dernier administrateur et de supprimer un rôle système', async () => {
    const admin = await t.as('ADMIN');
    const roles = await t.get('/roles', admin).expect(200);
    const adminRole = roles.body.find((r: { systemKey: string }) => r.systemKey === 'ADMIN');
    const del = await t.delete(`/roles/${adminRole.id}`, admin);
    expect(del.body.code).toBe('SYSTEM_ROLE_PROTECTED');
    const self = await t.post(`/users/${admin.userId}/disable`, admin);
    expect(self.status).toBe(403);
  });
});

describe('Journal d’audit (RG-20)', () => {
  it('chaîne les entrées et détecte une altération', async () => {
    const admin = await t.as('ADMIN');
    const ok = await t.post('/audit/verify', admin).expect(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.checked).toBeGreaterThan(5);

    // Une modification directe est bloquée par le trigger…
    await expect(
      t.prisma.$executeRawUnsafe(`UPDATE audit_logs SET summary = 'x' WHERE id = 1`),
    ).rejects.toThrow(/ajout seul/);
    await expect(t.prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = 1`)).rejects.toThrow(
      /ajout seul/,
    );
    // … et si un attaquant contourne le trigger, la vérification détecte l'altération.
    await t.prisma.$executeRawUnsafe(
      `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`,
    );
    try {
      await t.prisma.$executeRawUnsafe(`UPDATE audit_logs SET summary = 'altéré' WHERE id = 2`);
      const broken = await t.post('/audit/verify', admin).expect(201);
      expect(broken.body.ok).toBe(false);
      expect(broken.body.brokenAtId).toBe(2);
    } finally {
      await t.prisma.$executeRawUnsafe(
        `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`,
      );
    }
  });
});
