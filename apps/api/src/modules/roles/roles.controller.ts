import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { roleSchema, type RoleInput } from '@pharmastock/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody } from '../../common/zod.js';
import { RolesService } from './roles.service.js';

@RequirePermission('admin.roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  catalog() {
    return this.roles.catalog();
  }

  @RequirePermission('admin.users')
  @Get()
  list() {
    return this.roles.list();
  }

  @Post()
  create(@ZBody(roleSchema) body: RoleInput, @CurrentActor() actor: Actor) {
    return this.roles.create(body, actor);
  }

  @Put(':id')
  update(@IdParam() id: string, @ZBody(roleSchema) body: RoleInput, @CurrentActor() actor: Actor) {
    return this.roles.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.roles.remove(id, actor);
  }
}
