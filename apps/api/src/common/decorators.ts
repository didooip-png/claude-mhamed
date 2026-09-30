import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@pharmastock/shared';
import { AppError } from './app-error.js';
import { RequestContext, type Actor } from './request-context.js';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_DEVICE = 'allowPendingDevice';
export const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const SKIP_DEVICE = 'skipDevice';

/** Route accessible sans authentification. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route accessible depuis un poste en attente d'approbation. */
export const AllowPendingDevice = () => SetMetadata(ALLOW_PENDING_DEVICE, true);
/** Route accessible sans poste (santé, enregistrement du poste). */
export const SkipDevice = () => SetMetadata(SKIP_DEVICE, true);
/** Route accessible même si l'utilisateur doit changer son mot de passe. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);
/** Permission(s) exigée(s) — toutes doivent être présentes. Contrôle côté serveur. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export function currentActor(): Actor {
  const ctx = RequestContext.get();
  if (!ctx?.user) throw new AppError('UNAUTHENTICATED');
  return {
    userId: ctx.user.id,
    userCode: ctx.user.code,
    userName: ctx.user.fullName,
    permissions: ctx.user.permissions,
    isAdmin: ctx.user.isAdminRole,
    deviceId: ctx.device?.id ?? null,
    deviceName: ctx.device?.name ?? null,
    siteId: ctx.device?.siteId ?? '',
    ip: ctx.ip,
    sessionId: ctx.user.sessionId,
  };
}

/** Acteur courant (utilisateur + poste + IP). */
export const CurrentActor = createParamDecorator((_data: unknown, _ctx: ExecutionContext) => currentActor());
