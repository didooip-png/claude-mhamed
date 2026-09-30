import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS, PREPARER_DEFAULT_PERMISSIONS, type Permission } from '@pharmastock/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/common/decorators.js';
import { TestContext, type Session } from './helpers.js';

interface RouteInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  label: string;
  isPublic: boolean;
  permissions: Permission[];
}

const METHODS: Record<number, RouteInfo['method']> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const UUID = '00000000-0000-4000-8000-000000000000';

/** Toutes les routes déclarées par les contrôleurs (lecture des métadonnées Nest). */
function collectRoutes(): RouteInfo[] {
  const controllers: (new (...args: never[]) => object)[] =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  const routes: RouteInfo[] = [];
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const path = `/${[base, sub === '/' ? '' : sub].filter(Boolean).join('/')}`.replace(
        /\/+/g,
        '/',
      );
      const meta = <T>(key: string): T | undefined =>
        (Reflect.getMetadata(key, handler) as T | undefined) ??
        (Reflect.getMetadata(key, controller) as T | undefined);
      routes.push({
        method: METHODS[method] ?? 'get',
        path,
        label: `${(METHODS[method] ?? 'get').toUpperCase()} ${path}`,
        isPublic: meta<boolean>(IS_PUBLIC) === true,
        permissions: meta<Permission[]>(REQUIRED_PERMISSIONS) ?? [],
      });
    }
  }
  return routes;
}

/**
 * Routes ouvertes à tout utilisateur connecté (sans permission particulière) : liste FERMÉE.
 * Ajouter une route sans permission fait échouer ce test : il faut la justifier ici.
 */
const ANY_AUTHENTICATED = new Set([
  // Session et compte de l'utilisateur connecté.
  'GET /auth/me',
  'POST /auth/logout',
  'POST /auth/change-password',
  'POST /auth/change-pin',
  'GET /auth/sessions',
  'POST /auth/switch-user',
  'POST /auth/lock',
  'POST /auth/verify-pin',
  'POST /auth/totp/setup',
  'POST /auth/totp/enable',
  'POST /auth/totp/disable',
  // Notifications personnelles.
  'GET /notifications',
  'GET /notifications/unread-count',
  'POST /notifications/read-all',
  'POST /notifications/:id/read',
  'GET /notifications/preferences',
  'PUT /notifications/preferences',
  'POST /notifications/preferences/reset',
  // Utilitaires transverses : annuaire minimal (code + nom), pièces jointes (identifiants
  // non devinables, contrôle de type/taille à l'envoi), disponibilité de l'envoi d'e-mails,
  // tableau de bord (le contenu dépend de `dashboard.full` côté service).
  'GET /users/directory',
  'POST /attachments',
  'GET /attachments/:id',
  'GET /email/status',
  'GET /dashboard',
  'GET /settings/public',
]);

let admin: Session & { code: string };
let prep: Session & { code: string };
const t = new TestContext();
const routes = collectRoutes();

beforeAll(async () => {
  await t.start();
  admin = await t.as('ADMIN');
  prep = await t.as('PREPARER');
});

afterAll(async () => {
  await t.stop();
});

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, UUID);

describe('audit des routes', () => {
  it('découvre les routes', () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  it('chaque route non publique exige une permission (ou figure sur la liste fermée)', () => {
    const open = routes
      .filter((r) => !r.isPublic && r.permissions.length === 0)
      .map((r) => r.label);
    const unexpected = open.filter((l) => !ANY_AUTHENTICATED.has(l));
    expect(unexpected, `Routes sans permission non justifiées : ${unexpected.join(', ')}`).toEqual(
      [],
    );
  });

  it('la liste des routes sans permission ne contient pas d’entrée périmée', () => {
    const labels = new Set(routes.map((r) => r.label));
    const stale = [...ANY_AUTHENTICATED].filter((l) => !labels.has(l));
    expect(stale, `Entrées inexistantes : ${stale.join(', ')}`).toEqual([]);
  });

  it('toute route non publique répond 401 sans jeton', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await t.http[r.method](`/api/v1${concrete(r.path)}`).set(
        // Poste approuvé, mais aucun jeton.
        { 'X-Device-Id': t.device.id, 'X-Device-Token': t.device.token },
      );
      if (res.status !== 401) bad.push(`${r.label} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('un préparateur reçoit 403 sur toute route dont il n’a pas la permission', async () => {
    const prepAllowed = new Set<Permission>(PREPARER_DEFAULT_PERMISSIONS);
    const restricted = routes.filter(
      (r) => !r.isPublic && r.permissions.some((p) => !prepAllowed.has(p)),
    );
    expect(restricted.length).toBeGreaterThan(80);
    const bad: string[] = [];
    for (const r of restricted) {
      const res = await t.http[r.method](`/api/v1${concrete(r.path)}`)
        .set(t.auth(prep))
        .send({});
      if (res.status !== 403) bad.push(`${r.label} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('l’administrateur n’est jamais bloqué par la garde (aucune route en 401/403)', async () => {
    // Uniquement les routes en lecture : pas d’effet de bord.
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && x.method === 'get')) {
      const res = await t.http.get(`/api/v1${concrete(r.path)}`).set(t.auth(admin));
      if (res.status === 401 || res.status === 403) bad.push(`${r.label} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('les permissions déclarées existent toutes dans le registre', () => {
    const unknown = routes.flatMap((r) => r.permissions.filter((p) => !(p in PERMISSIONS)));
    expect(unknown).toEqual([]);
  });
});
