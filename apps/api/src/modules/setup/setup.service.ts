import { Injectable } from '@nestjs/common';
import { checkPasswordPolicy } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SitesService } from '../devices/sites.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface FirstAdminInput {
  code: string;
  username: string;
  fullName: string;
  password: string;
  pin: string;
  establishmentName?: string;
  mustChangePassword?: boolean;
}

/** Première installation : premier administrateur, taux de TVA initiaux, établissement (§13). */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly sites: SitesService,
  ) {}

  async hasAdmin(): Promise<boolean> {
    return (await this.prisma.user.count({ where: { role: { systemKey: 'ADMIN' } } })) > 0;
  }

  async createFirstAdmin(input: FirstAdminInput): Promise<Actor> {
    if (await this.hasAdmin())
      throw new AppError('CONFLICT', undefined, { message: 'Un administrateur existe déjà.' });
    const policy = checkPasswordPolicy(input.password, 8);
    if (policy) throw new AppError('PASSWORD_POLICY', undefined, { message: policy });
    if (!/^\d{4,6}$/.test(input.pin))
      throw new AppError('VALIDATION_ERROR', undefined, { message: 'PIN à 4–6 chiffres' });
    const site = await this.sites.defaultSite();
    const role = await this.prisma.role.findUniqueOrThrow({ where: { systemKey: 'ADMIN' } });
    const [passwordHash, pinHash] = await Promise.all([
      this.passwords.hash(input.password),
      this.passwords.hash(input.pin),
    ]);
    const user = await this.prisma.tx(async (tx) => {
      const created = await tx.user.create({
        data: {
          code: input.code.toUpperCase(),
          username: input.username.toLowerCase(),
          fullName: input.fullName,
          roleId: role.id,
          passwordHash,
          pinHash,
          mustChangePassword: input.mustChangePassword ?? true,
        },
      });
      const defaults = [
        { label: 'Exonéré (0 %)', rateBp: 0, isDefault: false },
        { label: 'TVA 7 %', rateBp: 700, isDefault: true },
        { label: 'TVA 13 %', rateBp: 1300, isDefault: false },
        { label: 'TVA 19 %', rateBp: 1900, isDefault: false },
      ];
      for (const rate of defaults) {
        await tx.tvaRate.upsert({ where: { label: rate.label }, create: rate, update: {} });
      }
      if (input.establishmentName) {
        await tx.setting.upsert({
          where: { key: 'establishment.name' },
          create: {
            key: 'establishment.name',
            value: input.establishmentName,
            updatedById: created.id,
          },
          update: { value: input.establishmentName, updatedById: created.id },
        });
      }
      await this.audit.record(tx, {
        eventType: 'USER_CREATED',
        user: { id: created.id, code: created.code, name: created.fullName },
        entityType: 'user',
        entityId: created.id,
        entityRef: created.code,
        summary: `Installation : premier administrateur ${created.code} — ${created.fullName} créé`,
        notify: false,
      });
      return created;
    });
    this.settings.invalidate();
    return {
      userId: user.id,
      userCode: user.code,
      userName: user.fullName,
      permissions: new Set(),
      isAdmin: true,
      deviceId: null,
      deviceName: null,
      siteId: site.id,
      ip: null,
    };
  }
}
