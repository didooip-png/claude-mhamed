import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type OverrideInput, type Permission } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from './auth.service.js';

export interface OverrideGrant {
  id: string;
  code: string;
  name: string;
  reason: string;
}

/**
 * Autorisations « 🔑 » (§5.4) : collecte les permissions manquantes d'une opération,
 * puis exige le code + PIN d'un administrateur qui les possède toutes. L'autorisation
 * vaut pour une seule exécution et est tracée (ADMIN_OVERRIDE).
 */
export class OverrideRequirements {
  readonly missing = new Map<Permission, string>();

  constructor(private readonly actor: Actor) {}

  /** Exige une permission ; si l'acteur ne l'a pas, elle devra être autorisée par un administrateur. */
  require(permission: Permission, why: string): void {
    if (!this.actor.permissions.has(permission) && !this.missing.has(permission)) this.missing.set(permission, why);
  }

  get needed(): boolean {
    return this.missing.size > 0;
  }

  describe(): { permission: Permission; label: string; why: string }[] {
    return [...this.missing.entries()].map(([permission, why]) => ({
      permission,
      label: PERMISSIONS[permission].label,
      why,
    }));
  }
}

@Injectable()
export class OverrideService {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Vérifie les exigences : sans autorisation fournie → OVERRIDE_REQUIRED (avec la liste) ;
   * avec autorisation → vérifie code + PIN et permissions de l'administrateur.
   * Permissions non « overridable » manquantes → FORBIDDEN.
   */
  async resolve(
    tx: Tx,
    requirements: OverrideRequirements,
    override: OverrideInput | undefined,
    actor: Actor,
    context: { entityType: string; entityId?: string; entityRef?: string | null; action: string },
  ): Promise<OverrideGrant | null> {
    if (!requirements.needed) return null;
    const needed = requirements.describe();
    const notOverridable = needed.filter((n) => !PERMISSIONS[n.permission].overridable);
    if (notOverridable.length > 0) {
      throw new AppError('FORBIDDEN', { permissions: notOverridable });
    }
    if (!override) throw new AppError('OVERRIDE_REQUIRED', { requirements: needed });

    let authorizer;
    try {
      authorizer = await this.auth.checkPin(override.userCode, override.pin, {
        device: actor.deviceId ? { id: actor.deviceId, name: actor.deviceName ?? '' } : null,
        ip: actor.ip,
      });
    } catch (err) {
      throw new AppError('OVERRIDE_INVALID', {
        requirements: needed,
        cause: err instanceof AppError ? err.code : 'ERROR',
        userCode: override.userCode,
      });
    }
    const me = this.auth.toMe(authorizer);
    const lacking = needed.filter((n) => !me.permissions.includes(n.permission));
    if (authorizer.id === actor.userId || lacking.length > 0) {
      throw new AppError('OVERRIDE_INVALID', {
        requirements: needed,
        cause: authorizer.id === actor.userId ? 'SELF' : 'INSUFFICIENT_RIGHTS',
        userCode: override.userCode,
      });
    }

    const grant: OverrideGrant = { id: authorizer.id, code: authorizer.code, name: authorizer.fullName, reason: override.reason };
    await this.audit.record(tx, {
      eventType: 'ADMIN_OVERRIDE',
      actor,
      authorizedBy: { id: grant.id, code: grant.code },
      entityType: context.entityType,
      entityId: context.entityId,
      entityRef: context.entityRef ?? null,
      summary: `${grant.code} a autorisé ${actor.userCode} : ${context.action} (${needed.map((n) => n.why).join(' ; ')})`,
      reason: override.reason,
      metadata: { requirements: needed },
    });
    return grant;
  }
}
