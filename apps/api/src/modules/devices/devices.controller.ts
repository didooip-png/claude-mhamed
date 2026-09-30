import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  registerDeviceSchema,
  renameDeviceSchema,
  type RegisterDeviceInput,
} from '@pharmastock/shared';
import {
  AllowPendingDevice,
  CurrentActor,
  Public,
  RequirePermission,
  SkipDevice,
} from '../../common/decorators.js';
import { RequestContext, type Actor } from '../../common/request-context.js';
import { IdParam, ZBody } from '../../common/zod.js';
import { DevicesService } from './devices.service.js';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Enregistrement d'un nouveau poste (navigateur ou application de bureau). */
  @Public()
  @SkipDevice()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@ZBody(registerDeviceSchema) body: RegisterDeviceInput) {
    const ctx = RequestContext.get();
    return this.devices.register(body, ctx?.ip ?? null, ctx?.userAgent ?? null);
  }

  /** État du poste courant (y compris en attente d'approbation). */
  @Public()
  @AllowPendingDevice()
  @Get('current')
  current() {
    const device = RequestContext.get()?.device;
    return { id: device?.id, name: device?.name, status: device?.status };
  }

  @RequirePermission('admin.devices')
  @Get()
  list() {
    return this.devices.list();
  }

  @RequirePermission('admin.devices')
  @Post(':id/approve')
  @HttpCode(204)
  async approve(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.devices.setStatus(id, 'APPROVED', actor);
  }

  @RequirePermission('admin.devices')
  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.devices.setStatus(id, 'REVOKED', actor);
  }

  @RequirePermission('admin.devices')
  @Post(':id/rename')
  @HttpCode(204)
  async rename(
    @IdParam() id: string,
    @ZBody(renameDeviceSchema) body: { name: string },
    @CurrentActor() actor: Actor,
  ) {
    await this.devices.rename(id, body.name, actor);
  }
}
