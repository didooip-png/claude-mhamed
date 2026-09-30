import { Injectable } from '@nestjs/common';
import {
  defaultSettings,
  isSettingKey,
  SETTINGS_DEFINITIONS,
  type SettingKey,
  type SettingsMap,
  type SettingValue,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { zodIssuesToDetails } from '../../common/zod.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const CACHE_TTL_MS = 5_000;

@Injectable()
export class SettingsService {
  private cache: { values: SettingsMap; loadedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private defaults(): SettingsMap {
    const d = defaultSettings();
    // Approbation des postes : activée par défaut en production uniquement (§5.5).
    d['security.require_device_approval'] = loadConfig().isProduction;
    return d;
  }

  async all(client: Tx | PrismaService = this.prisma): Promise<SettingsMap> {
    if (client === this.prisma && this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.values;
    }
    const rows = await client.setting.findMany({ where: { key: { in: Object.keys(SETTINGS_DEFINITIONS) } } });
    const values = this.defaults();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      const parsed = SETTINGS_DEFINITIONS[row.key].schema.safeParse(row.value);
      if (parsed.success) (values as Record<string, unknown>)[row.key] = parsed.data;
    }
    if (client === this.prisma) this.cache = { values, loadedAt: Date.now() };
    return values;
  }

  async get<K extends SettingKey>(key: K, client?: Tx): Promise<SettingValue<K>> {
    const values = await this.all(client);
    return values[key];
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Met à jour plusieurs paramètres (validation stricte, trace SETTING_CHANGED par clé). */
  async update(values: Record<string, unknown>, actor: Actor): Promise<SettingsMap> {
    const errors: Record<string, string> = {};
    const parsed: [SettingKey, unknown][] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!isSettingKey(key)) {
        errors[key] = 'Paramètre inconnu';
        continue;
      }
      const result = SETTINGS_DEFINITIONS[key].schema.safeParse(value);
      if (!result.success) {
        errors[key] = Object.values(zodIssuesToDetails(result.error).fieldErrors as Record<string, string>)[0] ?? 'Valeur invalide';
        continue;
      }
      parsed.push([key, result.data]);
    }
    if (Object.keys(errors).length > 0) throw new AppError('VALIDATION_ERROR', { fieldErrors: errors });

    await this.prisma.tx(async (tx) => {
      const current = await this.all(tx);
      for (const [key, value] of parsed) {
        const before = current[key];
        if (JSON.stringify(before) === JSON.stringify(value)) continue;
        await tx.setting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.userId },
          update: { value: value as Prisma.InputJsonValue, updatedById: actor.userId, version: { increment: 1 } },
        });
        await this.audit.record(tx, {
          eventType: 'SETTING_CHANGED',
          actor,
          entityType: 'setting',
          entityId: key,
          entityRef: SETTINGS_DEFINITIONS[key].label,
          summary: `Paramètre « ${SETTINGS_DEFINITIONS[key].label} » modifié`,
          before: { value: before },
          after: { value },
        });
      }
    });
    this.invalidate();
    return this.all();
  }

  /** Lecture/écriture de valeurs internes hors catalogue (ex. smtp.*), jamais exposées telles quelles. */
  async getRaw<T>(key: string, client: Tx | PrismaService = this.prisma): Promise<T | null> {
    const row = await client.setting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  async setRaw(tx: Tx, key: string, value: unknown, actorId: string | null): Promise<void> {
    await tx.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
      update: { value: value as Prisma.InputJsonValue, updatedById: actorId, version: { increment: 1 } },
    });
  }
}
