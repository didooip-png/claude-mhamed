import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  createUserSchema,
  resetCredentialsSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@pharmastock/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody } from '../../common/zod.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Annuaire minimal (code + nom) : filtres des écrans, accessible à tout utilisateur connecté. */
  @Get('directory')
  directory() {
    return this.users.directory();
  }

  @RequirePermission('admin.users')
  @Get()
  list() {
    return this.users.list();
  }

  @RequirePermission('admin.users')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.users.get(id);
  }

  @RequirePermission('admin.users')
  @Post()
  create(@ZBody(createUserSchema) body: CreateUserInput, @CurrentActor() actor: Actor) {
    return this.users.create(body, actor);
  }

  @RequirePermission('admin.users')
  @Put(':id')
  update(@IdParam() id: string, @ZBody(updateUserSchema) body: UpdateUserInput, @CurrentActor() actor: Actor) {
    return this.users.update(id, body, actor);
  }

  @RequirePermission('admin.users')
  @Post(':id/disable')
  @HttpCode(204)
  async disable(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.users.setActive(id, false, actor);
  }

  @RequirePermission('admin.users')
  @Post(':id/enable')
  @HttpCode(204)
  async enable(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.users.setActive(id, true, actor);
  }

  @RequirePermission('admin.users')
  @Post(':id/reset-credentials')
  @HttpCode(204)
  async reset(@IdParam() id: string, @ZBody(resetCredentialsSchema) body: { password?: string; pin?: string }, @CurrentActor() actor: Actor) {
    await this.users.resetCredentials(id, body, actor);
  }

  @RequirePermission('admin.users')
  @Post(':id/unlock')
  @HttpCode(204)
  async unlock(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.users.unlock(id, actor);
  }
}
