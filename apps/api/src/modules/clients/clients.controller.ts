import { Controller, Get, Post, Put } from '@nestjs/common';
import { clientSchema, paginationSchema, quickClientSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { ClientsService } from './clients.service.js';

const listSchema = paginationSchema.extend({
  active: z.enum(['true', 'false', 'all']).optional(),
  type: z.string().max(20).optional(),
  balance: z.enum(['debt', 'credit']).optional(),
});

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermission('clients.view')
  @Get()
  list(@ZQuery(listSchema) q: z.infer<typeof listSchema>) {
    return this.clients.list(q);
  }

  @RequirePermission('clients.view')
  @Get('search')
  search(@ZQuery(z.object({ q: z.string().max(100).default('') })) q: { q: string }) {
    return this.clients.search(q.q);
  }

  @RequirePermission('clients.view')
  @Get(':id')
  get(@IdParam() id: string) {
    return this.clients.get(id);
  }

  @RequirePermission('clients.create')
  @Post()
  create(@ZBody(clientSchema) body: z.output<typeof clientSchema>, @CurrentActor() actor: Actor) {
    return this.clients.create(body, actor);
  }

  /** Création rapide depuis la caisse (nom + téléphone). */
  @RequirePermission('clients.create')
  @Post('quick')
  quick(
    @ZBody(quickClientSchema) body: z.output<typeof quickClientSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.clients.quickCreate(body, actor);
  }

  @RequirePermission('clients.edit')
  @Put(':id')
  update(
    @IdParam() id: string,
    @ZBody(clientSchema) body: z.output<typeof clientSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.clients.update(id, body, actor);
  }
}
