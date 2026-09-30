import { Controller, Get, Put } from '@nestjs/common';
import { PUBLIC_SETTING_KEYS, SETTINGS_DEFINITIONS, SETTINGS_GROUPS, updateSettingsSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { ZBody } from '../../common/zod.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Paramètres nécessaires à l'interface (affichage, règles de caisse) — tout utilisateur connecté. */
  @Get('public')
  async publicSettings() {
    const all = await this.settings.all();
    return Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, all[k]]));
  }

  @RequirePermission('admin.settings')
  @Get()
  async list() {
    const values = await this.settings.all();
    return {
      groups: SETTINGS_GROUPS,
      definitions: Object.fromEntries(
        Object.entries(SETTINGS_DEFINITIONS).map(([key, def]) => [
          key,
          { group: def.group, label: def.label, help: def.help ?? null, schema: z.toJSONSchema(def.schema, { unrepresentable: 'any' }) },
        ]),
      ),
      values,
    };
  }

  @RequirePermission('admin.settings')
  @Put()
  update(@ZBody(updateSettingsSchema) body: { values: Record<string, unknown> }, @CurrentActor() actor: Actor) {
    return this.settings.update(body.values, actor);
  }
}
