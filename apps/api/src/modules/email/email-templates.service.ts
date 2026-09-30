import { Injectable } from '@nestjs/common';
import mjml2html from 'mjml';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { loadConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DEFAULT_TEMPLATES, wrapLayout, type EmailTemplateDefinition } from './templates.js';

/** Variables injectées telles quelles (HTML généré par l'application, jamais par l'utilisateur). */
const RAW_HTML_VARIABLES = new Set(['resume.contenu']);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(vars: Record<string, unknown>, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      vars,
    );
  return value === null || value === undefined ? '' : String(value);
}

export function substitute(
  template: string,
  vars: Record<string, unknown>,
  mode: 'html' | 'text' | 'subject',
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const value = lookup(vars, path);
    if (mode === 'text') return value;
    if (mode === 'subject') return value.replace(/[\r\n]+/g, ' ');
    if (RAW_HTML_VARIABLES.has(path)) return value;
    return escapeHtml(value).replace(/\n/g, '<br/>');
  });
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Modèles d'e-mails modifiables par l'administrateur, avec aperçu et restauration (§6.19 D). */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private definition(key: string): EmailTemplateDefinition {
    const def = DEFAULT_TEMPLATES.find((t) => t.key === key);
    if (!def) throw new AppError('NOT_FOUND', { entity: 'template' });
    return def;
  }

  async list() {
    const custom = await this.prisma.emailTemplate.findMany();
    return DEFAULT_TEMPLATES.map((d) => {
      const c = custom.find((x) => x.key === d.key);
      return {
        key: d.key,
        label: d.label,
        audience: d.audience,
        variables: d.variables,
        subject: c?.subject ?? d.subject,
        body: c?.bodyMjml ?? d.body,
        text: c?.bodyText ?? d.text,
        isCustomized: !!c?.isCustomized,
        updatedAt: c?.updatedAt ?? null,
      };
    });
  }

  async get(key: string) {
    const all = await this.list();
    const t = all.find((x) => x.key === key);
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  async update(key: string, input: { subject: string; body: string; text: string }, actor: Actor) {
    this.definition(key);
    // Vérifie que le MJML est valide avant d'enregistrer.
    await this.compile(key, input.body, {});
    const before = await this.get(key);
    await this.prisma.tx(async (tx) => {
      await tx.emailTemplate.upsert({
        where: { key },
        create: {
          key,
          subject: input.subject,
          bodyMjml: input.body,
          bodyText: input.text,
          isCustomized: true,
          updatedById: actor.userId,
        },
        update: {
          subject: input.subject,
          bodyMjml: input.body,
          bodyText: input.text,
          isCustomized: true,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        eventType: 'EMAIL_TEMPLATE_CHANGED',
        actor,
        entityType: 'email_template',
        entityId: key,
        entityRef: before.label,
        summary: `Modèle d’e-mail « ${before.label} » modifié`,
        before: { subject: before.subject },
        after: { subject: input.subject },
        notify: false,
      });
    });
    return this.get(key);
  }

  async reset(key: string, actor: Actor) {
    const def = this.definition(key);
    await this.prisma.tx(async (tx) => {
      await tx.emailTemplate.deleteMany({ where: { key } });
      await this.audit.record(tx, {
        eventType: 'EMAIL_TEMPLATE_CHANGED',
        actor,
        entityType: 'email_template',
        entityId: key,
        entityRef: def.label,
        summary: `Modèle d’e-mail « ${def.label} » restauré par défaut`,
        notify: false,
      });
    });
    return this.get(key);
  }

  /** Variables communes à tous les modèles (établissement, liens). */
  async baseVariables(): Promise<Record<string, unknown>> {
    const s = await this.settings.all();
    const base = loadConfig().APP_PUBLIC_URL.replace(/\/$/, '');
    return {
      etablissement: {
        nom: s['establishment.name'],
        telephone: s['establishment.phone'],
        adresse: s['establishment.address'],
        email: s['establishment.email'],
      },
      lien: base,
      lien_notifications: `${base}/account/notifications`,
    };
  }

  private async compile(key: string, body: string, vars: Record<string, unknown>): Promise<string> {
    const def = this.definition(key);
    const s = await this.settings.all();
    const mjml = wrapLayout(body, {
      color: s['establishment.primary_color'],
      audience: def.audience,
      logoUrl: null,
    });
    const result = await mjml2html(substitute(mjml, vars, 'html'), {
      validationLevel: 'soft',
      keepComments: false,
    });
    const fatal = (result.errors ?? []).filter(
      (e: { message?: string }) => !/has invalid value|unknown attribute/i.test(e.message ?? ''),
    );
    if (fatal.length > 0 && !result.html) {
      throw new AppError('VALIDATION_ERROR', {
        fieldErrors: { body: `Modèle invalide : ${fatal[0]?.message ?? ''}` },
      });
    }
    return result.html;
  }

  async render(key: string, vars: Record<string, unknown>): Promise<RenderedEmail> {
    const t = await this.get(key);
    const all = { ...(await this.baseVariables()), ...vars };
    return {
      subject: substitute(t.subject, all, 'subject').slice(0, 250),
      html: await this.compile(key, t.body, all),
      text: substitute(t.text, all, 'text'),
    };
  }

  /** Aperçu avec des données d'exemple. */
  async preview(
    key: string,
    draft?: { subject: string; body: string; text: string },
  ): Promise<RenderedEmail> {
    const sample = {
      client: { nom: 'Mme Leila Mansour' },
      document: {
        numero: 'FAC-2026-000123',
        date: '30/09/2026',
        montant: '45,750 DT',
        reste_a_payer: '0,000 DT',
      },
      message: '',
      notification: {
        titre: 'Vente annulée',
        detail: 'Vente FAC-2026-000123 annulée — 45,750 DT',
        utilisateur: 'PRE01 — Karim Trabelsi',
        date: '30/09/2026 14:05:32',
      },
      resume: {
        titre: 'Résumé quotidien',
        contenu: '<p>3 annulations, 2 ruptures de stock.</p>',
        texte: '3 annulations, 2 ruptures de stock.',
      },
      utilisateur: 'ADM01',
      date: '30/09/2026 14:05',
    };
    if (!draft) return this.render(key, sample);
    const all = { ...(await this.baseVariables()), ...sample };
    return {
      subject: substitute(draft.subject, all, 'subject'),
      html: await this.compile(key, draft.body, all),
      text: substitute(draft.text, all, 'text'),
    };
  }
}
