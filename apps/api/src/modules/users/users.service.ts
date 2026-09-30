import { Injectable } from '@nestjs/common';
import { checkPasswordPolicy, type CreateUserInput, type UpdateUserInput } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SettingsService } from '../settings/settings.service.js';

const userSelect = {
  id: true,
  code: true,
  username: true,
  fullName: true,
  email: true,
  isActive: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
  totpEnabled: true,
  version: true,
  createdAt: true,
  role: { select: { id: true, name: true, systemKey: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
  ) {}

  list() {
    return this.prisma.user.findMany({ select: userSelect, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
  }

  /** Liste minimale (code + nom) pour les filtres (mouchard, ventes, abonnements). */
  directory() {
    return this.prisma.user.findMany({
      select: { id: true, code: true, fullName: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new AppError('NOT_FOUND');
    return user;
  }

  private async assertPassword(password: string): Promise<void> {
    const min = await this.settings.get('security.password_min_length');
    const error = checkPasswordPolicy(password, min);
    if (error) throw new AppError('PASSWORD_POLICY', { fieldErrors: { password: error } }, { status: 400 });
  }

  async create(input: CreateUserInput, actor: Actor) {
    await this.assertPassword(input.password);
    const [passwordHash, pinHash] = await Promise.all([this.passwords.hash(input.password), this.passwords.hash(input.pin)]);
    return this.prisma.tx(async (tx) => {
      const role = await tx.role.findUnique({ where: { id: input.roleId } });
      if (!role) throw new AppError('VALIDATION_ERROR', { fieldErrors: { roleId: 'Rôle inconnu' } });
      const clash = await tx.user.findFirst({ where: { OR: [{ code: input.code }, { username: input.username }] } });
      if (clash) {
        throw new AppError('DUPLICATE_CODE', {
          fieldErrors: clash.code === input.code ? { code: 'Code déjà utilisé' } : { username: 'Identifiant déjà utilisé' },
        });
      }
      const user = await tx.user.create({
        data: {
          code: input.code,
          username: input.username,
          fullName: input.fullName,
          email: input.email || null,
          roleId: role.id,
          passwordHash,
          pinHash,
          mustChangePassword: true,
          createdById: actor.userId,
        },
        select: userSelect,
      });
      await this.audit.record(tx, {
        eventType: 'USER_CREATED',
        actor,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `Utilisateur ${user.code} — ${user.fullName} créé (rôle ${role.name})`,
        after: { code: user.code, username: user.username, fullName: user.fullName, role: role.name },
      });
      return user;
    });
  }

  private async assertNotLastAdmin(tx: Tx, userId: string): Promise<void> {
    const admins = await tx.user.count({ where: { isActive: true, role: { systemKey: 'ADMIN' }, NOT: { id: userId } } });
    if (admins === 0) throw new AppError('LAST_ADMIN');
  }

  async update(id: string, input: UpdateUserInput, actor: Actor) {
    const result = await this.prisma.tx(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, include: { role: true } });
      if (!before) throw new AppError('NOT_FOUND');
      if (before.version !== input.version) throw new AppError('VERSION_CONFLICT');
      const role = await tx.role.findUnique({ where: { id: input.roleId } });
      if (!role) throw new AppError('VALIDATION_ERROR', { fieldErrors: { roleId: 'Rôle inconnu' } });
      if (before.role.systemKey === 'ADMIN' && role.systemKey !== 'ADMIN') await this.assertNotLastAdmin(tx, id);
      const user = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          email: input.email || null,
          roleId: role.id,
          version: { increment: 1 },
          updatedById: actor.userId,
        },
        select: userSelect,
      });
      await this.audit.record(tx, {
        eventType: 'USER_UPDATED',
        actor,
        entityType: 'user',
        entityId: id,
        entityRef: user.code,
        summary: `Utilisateur ${user.code} modifié${before.roleId !== role.id ? ` (rôle : ${before.role.name} → ${role.name})` : ''}`,
        before: { fullName: before.fullName, email: before.email, role: before.role.name },
        after: { fullName: user.fullName, email: user.email, role: role.name },
      });
      return user;
    });
    this.auth.invalidateCache();
    return result;
  }

  async setActive(id: string, active: boolean, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: { role: true } });
      if (!user) throw new AppError('NOT_FOUND');
      if (user.isActive === active) return;
      if (!active) {
        if (user.id === actor.userId) throw new AppError('FORBIDDEN', undefined, { message: 'Vous ne pouvez pas désactiver votre propre compte.' });
        if (user.role.systemKey === 'ADMIN') await this.assertNotLastAdmin(tx, id);
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Utilisateur désactivé' },
        });
      }
      await tx.user.update({ where: { id }, data: { isActive: active, version: { increment: 1 }, updatedById: actor.userId } });
      await this.audit.record(tx, {
        eventType: active ? 'USER_ENABLED' : 'USER_DISABLED',
        actor,
        entityType: 'user',
        entityId: id,
        entityRef: user.code,
        summary: `Utilisateur ${user.code} ${active ? 'réactivé' : 'désactivé'}`,
      });
    });
    this.auth.invalidateCache();
  }

  async resetCredentials(id: string, input: { password?: string; pin?: string }, actor: Actor) {
    if (!input.password && !input.pin) throw new AppError('VALIDATION_ERROR', { fieldErrors: { password: 'Mot de passe ou PIN requis' } });
    if (input.password) await this.assertPassword(input.password);
    const passwordHash = input.password ? await this.passwords.hash(input.password) : undefined;
    const pinHash = input.pin ? await this.passwords.hash(input.pin) : undefined;
    await this.prisma.tx(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new AppError('NOT_FOUND');
      await tx.user.update({
        where: { id },
        data: {
          ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
          ...(pinHash ? { pinHash } : {}),
          failedAttempts: 0,
          pinFailedAttempts: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      if (passwordHash) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Mot de passe réinitialisé' },
        });
      }
      await this.audit.record(tx, {
        eventType: 'USER_CREDENTIALS_RESET',
        actor,
        entityType: 'user',
        entityId: id,
        entityRef: user.code,
        summary: `Réinitialisation ${[passwordHash && 'du mot de passe', pinHash && 'du PIN'].filter(Boolean).join(' et ')} de ${user.code}`,
      });
    });
    this.auth.invalidateCache();
  }

  async unlock(id: string, actor: Actor) {
    await this.prisma.tx(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new AppError('NOT_FOUND');
      await tx.user.update({ where: { id }, data: { lockedUntil: null, failedAttempts: 0, pinFailedAttempts: 0 } });
      await this.audit.record(tx, {
        eventType: 'USER_UPDATED',
        actor,
        entityType: 'user',
        entityId: id,
        entityRef: user.code,
        summary: `Compte ${user.code} déverrouillé par ${actor.userCode}`,
      });
    });
  }
}
