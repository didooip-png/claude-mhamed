import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { formatDateTime, paginationSchema } from '@pharmastock/shared';
import { z } from 'zod';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, parseOrThrow, ZBody, ZQuery } from '../../common/zod.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailTemplatesService } from './email-templates.service.js';
import { EmailOutboxService } from './outbox.service.js';
import { SmtpService, smtpConfigSchema, type SmtpConfigInput } from './smtp.service.js';

const templateSchema = z.object({
  subject: z.string().trim().min(1, { error: 'Objet obligatoire' }).max(250),
  body: z.string().min(1, { error: 'Corps obligatoire' }).max(20_000),
  text: z.string().max(20_000),
});

const logSchema = paginationSchema.extend({
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED']).optional(),
  kind: z.string().max(60).optional(),
  clientId: z.uuid().optional(),
  entityId: z.uuid().optional(),
});

const templateKey = z.string().regex(/^[A-Z0-9_]{2,40}$/);

/** Administration → E-mail & notifications (§6.19 A, D, E). */
@Controller('email')
export class EmailController {
  constructor(
    private readonly smtp: SmtpService,
    private readonly templates: EmailTemplatesService,
    private readonly outbox: EmailOutboxService,
    private readonly settings: SettingsService,
  ) {}

  /** Disponibilité de l'envoi (boutons « Envoyer par e-mail » de l'interface). */
  @Get('status')
  async status() {
    return { operational: await this.smtp.isOperational() };
  }

  @RequirePermission('email.configure')
  @Get('smtp')
  config() {
    return this.smtp.publicConfig();
  }

  @RequirePermission('email.configure')
  @Put('smtp')
  update(@ZBody(smtpConfigSchema) body: SmtpConfigInput, @CurrentActor() actor: Actor) {
    return this.smtp.update(body, actor);
  }

  @RequirePermission('email.configure')
  @Post('smtp/test-connection')
  @HttpCode(200)
  testConnection(@CurrentActor() actor: Actor) {
    return this.smtp.testConnection(actor);
  }

  @RequirePermission('email.configure')
  @Post('smtp/test-send')
  @HttpCode(200)
  async testSend(
    @ZBody(z.object({ to: z.email({ error: 'E-mail invalide' }) })) body: { to: string },
    @CurrentActor() actor: Actor,
  ) {
    const tz = await this.settings.get('general.timezone');
    const rendered = await this.templates.render('TEST', {
      utilisateur: `${actor.userCode} — ${actor.userName}`,
      date: formatDateTime(new Date(), tz),
    });
    return this.smtp.sendTest(body.to, rendered, actor);
  }

  @RequirePermission('email.configure')
  @Get('templates')
  listTemplates() {
    return this.templates.list();
  }

  @RequirePermission('email.configure')
  @Get('templates/:key')
  getTemplate(@Param('key') key: string) {
    return this.templates.get(parseOrThrow(templateKey, key));
  }

  @RequirePermission('email.configure')
  @Put('templates/:key')
  updateTemplate(
    @Param('key') key: string,
    @ZBody(templateSchema) body: z.infer<typeof templateSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return this.templates.update(parseOrThrow(templateKey, key), body, actor);
  }

  @RequirePermission('email.configure')
  @Post('templates/:key/reset')
  @HttpCode(200)
  resetTemplate(@Param('key') key: string, @CurrentActor() actor: Actor) {
    return this.templates.reset(parseOrThrow(templateKey, key), actor);
  }

  /** Aperçu avec des données d'exemple (du modèle enregistré ou du brouillon en cours d'édition). */
  @RequirePermission('email.configure')
  @Post('templates/:key/preview')
  @HttpCode(200)
  preview(
    @Param('key') key: string,
    @ZBody(templateSchema.partial()) body: Partial<z.infer<typeof templateSchema>>,
  ) {
    const draft =
      body.subject !== undefined && body.body !== undefined
        ? { subject: body.subject, body: body.body, text: body.text ?? '' }
        : undefined;
    return this.templates.preview(parseOrThrow(templateKey, key), draft);
  }

  @RequirePermission('email.view_log')
  @Get('log')
  log(@ZQuery(logSchema) q: z.infer<typeof logSchema>) {
    return this.outbox.log(q);
  }

  @RequirePermission('email.view_log')
  @Post('log/:id/resend')
  @HttpCode(200)
  resend(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.outbox.resend(id, actor);
  }

  @RequirePermission('email.view_log')
  @Post('log/:id/cancel')
  @HttpCode(200)
  async cancel(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.outbox.cancel(id, actor);
    return { ok: true };
  }
}
