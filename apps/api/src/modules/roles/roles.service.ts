import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  PERMISSION_MODULES,
  PERMISSIONS,
  PREPARER_DEFAULT_PERMISSIONS,
  SYSTEM_ROLES,
  type Permission,
  type RoleInput,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Au démarrage : synchronise le catalogue des permissions (code → table `permissions`)
   * et garantit l'existence des deux rôles système (non supprimables).
   */
  async onModuleInit(): Promise<void> {
    for (const key of ALL_PERMISSIONS) {
      const def = PERMISSIONS[key];
      await this.prisma.permission.upsert({
        where: { key },
        create: { key, module: def.module, label: def.label },
        update: { module: def.module, label: def.label },
      });
    }
    await this.prisma.role.upsert({
      where: { systemKey: 'ADMIN' },
      create: { name: SYSTEM_ROLES.ADMIN, systemKey: 'ADMIN', isSystem: true, description: 'Accès illimité' },
      update: {},
    });
    const preparer = await this.prisma.role.findUnique({ where: { systemKey: 'PREPARER' } });
    if (!preparer) {
      await this.prisma.role.create({
        data: {
          name: SYSTEM_ROLES.PREPARER,
          systemKey: 'PREPARER',
          isSystem: true,
          description: 'Utilisation quotidienne, sans modification ni suppression d’opérations validées',
          permissions: { create: PREPARER_DEFAULT_PERMISSIONS.map((permissionKey) => ({ permissionKey })) },
        },
      });
    }
  }

  catalog() {
    return Object.entries(PERMISSION_MODULES).map(([module, label]) => ({
      module,
      label,
      permissions: ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].module === module).map((p) => ({
        key: p,
        label: PERMISSIONS[p].label,
        overridable: PERMISSIONS[p].overridable ?? false,
        preparerDefault: PERMISSIONS[p].preparer,
      })),
    }));
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      systemKey: r.systemKey,
      userCount: r._count.users,
      version: r.version,
      permissions: r.systemKey === 'ADMIN' ? [...ALL_PERMISSIONS] : r.permissions.map((p) => p.permissionKey),
    }));
  }

  async create(input: RoleInput, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const role = await tx.role.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          permissions: { create: input.permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await this.audit.record(tx, {
        eventType: 'ROLE_CREATED',
        actor,
        entityType: 'role',
        entityId: role.id,
        entityRef: role.name,
        summary: `Rôle « ${role.name} » créé (${input.permissions.length} permissions)`,
        after: { permissions: input.permissions },
      });
      return role;
    });
  }

  async update(id: string, input: RoleInput, actor: Actor) {
    const result = await this.prisma.tx(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!role) throw new AppError('NOT_FOUND');
      if (role.systemKey === 'ADMIN') throw new AppError('SYSTEM_ROLE_PROTECTED', undefined, { status: 400, message: 'Le rôle Administrateur dispose toujours de toutes les permissions.' });
      if (role.isSystem && input.name !== role.name) throw new AppError('SYSTEM_ROLE_PROTECTED', undefined, { status: 400 });
      const before = role.permissions.map((p) => p.permissionKey).sort();
      const after = [...new Set<Permission>(input.permissions)].sort();
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: after.map((permissionKey) => ({ roleId: id, permissionKey })) });
      const updated = await tx.role.update({
        where: { id },
        data: { name: input.name, description: input.description ?? null, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        eventType: 'ROLE_PERMISSIONS_CHANGED',
        actor,
        entityType: 'role',
        entityId: id,
        entityRef: updated.name,
        summary: `Permissions du rôle « ${updated.name} » modifiées`,
        before: { name: role.name, permissions: before },
        after: { name: updated.name, permissions: after },
        metadata: {
          added: after.filter((p) => !before.includes(p)),
          removed: before.filter((p) => !(after as string[]).includes(p)),
        },
      });
      return updated;
    });
    this.auth.invalidateCache();
    return result;
  }

  async remove(id: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
      if (!role) throw new AppError('NOT_FOUND');
      if (role.isSystem) throw new AppError('SYSTEM_ROLE_PROTECTED', undefined, { status: 400 });
      if (role._count.users > 0) throw new AppError('ROLE_IN_USE', undefined, { status: 400 });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, {
        eventType: 'ROLE_DELETED',
        actor,
        entityType: 'role',
        entityId: id,
        entityRef: role.name,
        summary: `Rôle « ${role.name} » supprimé`,
      });
    });
  }
}
