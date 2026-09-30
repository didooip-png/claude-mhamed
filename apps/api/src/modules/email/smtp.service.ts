import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { decryptSecret, encryptSecret } from '../../common/crypto.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';

const CONFIG_KEY = 'smtp.config';
const PASSWORD_KEY = 'smtp.password_encrypted';

const emailOrEmpty = z.union([z.email({ error: 'E-mail invalide' }), z.literal('')]);

export const smtpConfigSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['SSL', 'STARTTLS', 'NONE']),
  username: z.string().trim().max(200),
  /** Absent = mot de passe inchangé ; chaîne vide = suppression. */
  password: z.string().max(500).optional(),
  fromName: z.string().trim().max(120),
  fromEmail: emailOrEmpty,
  replyTo: emailOrEmpty,
  bccArchive: emailOrEmpty,
  hourlyLimit: z.number().int().min(1).max(100_000),
});
export type SmtpConfigInput = z.infer<typeof smtpConfigSchema>;

interface StoredConfig extends Omit<SmtpConfigInput, 'password'> {
  testedAt: string | null;
  testedFingerprint: string | null;
}

const DEFAULTS: StoredConfig = {
  enabled: false,
  host: '',
  port: 587,
  security: 'STARTTLS',
  username: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  bccArchive: '',
  hourlyLimit: 200,
  testedAt: null,
  testedFingerprint: null,
};

/** Empreinte des paramètres de connexion : un changement exige un nouveau test. */
function fingerprint(
  c: Pick<StoredConfig, 'host' | 'port' | 'security' | 'username'>,
  passwordVersion: number,
): string {
  return `${c.host}|${c.port}|${c.security}|${c.username}|${passwordVersion}`;
}

/** Messages d'erreur SMTP clairs en français (§6.19 A). */
export function smtpErrorMessage(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const msg = e.message ?? '';
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    return 'Authentification refusée : vérifiez l’identifiant et le mot de passe (Gmail / Microsoft 365 : utilisez un mot de passe d’application).';
  }
  if (e.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(msg))
    return 'Serveur SMTP introuvable : vérifiez le nom d’hôte.';
  if (/ECONNREFUSED/.test(msg) || e.code === 'ECONNECTION')
    return 'Connexion refusée : vérifiez l’hôte, le port et le type de sécurité (SSL = 465, STARTTLS = 587).';
  if (e.code === 'ETIMEDOUT' || /timeout/i.test(msg))
    return 'Délai de connexion dépassé : le port est peut-être bloqué par un pare-feu ou le fournisseur.';
  if (/certificate|self[- ]signed|CERT_/i.test(msg))
    return 'Certificat du serveur invalide ou non reconnu.';
  if (/wrong version number|ssl3_get_record|tls/i.test(msg))
    return 'Erreur TLS : le type de sécurité ne correspond pas au port (SSL = 465, STARTTLS = 587).';
  if (e.responseCode && e.responseCode >= 500)
    return `Le serveur a refusé le message (${e.responseCode}) : ${msg.slice(0, 200)}`;
  return `Erreur SMTP : ${msg.slice(0, 200) || 'inconnue'}`;
}

/** Configuration du serveur SMTP : mot de passe chiffré (AES-256-GCM), jamais renvoyé. */
@Injectable()
export class SmtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async stored(): Promise<StoredConfig> {
    return {
      ...DEFAULTS,
      ...((await this.settings.getRaw<Partial<StoredConfig>>(CONFIG_KEY)) ?? {}),
    };
  }

  private async passwordVersion(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: PASSWORD_KEY } });
    return row?.version ?? 0;
  }

  async publicConfig() {
    const c = await this.stored();
    const hasPassword = !!(await this.settings.getRaw<string>(PASSWORD_KEY));
    const tested =
      !!c.testedAt && c.testedFingerprint === fingerprint(c, await this.passwordVersion());
    return {
      ...c,
      passwordSet: hasPassword,
      tested,
      operational: c.enabled && !!c.host && !!c.fromEmail && tested,
    };
  }

  /** L'envoi n'est possible que si le SMTP est activé, configuré ET testé (§6.19). */
  async isOperational(): Promise<boolean> {
    return (await this.publicConfig()).operational;
  }

  async update(input: SmtpConfigInput, actor: Actor) {
    const before = await this.stored();
    const { password, ...rest } = input;
    await this.prisma.tx(async (tx) => {
      await this.settings.setRaw(tx, CONFIG_KEY, { ...before, ...rest }, actor.userId);
      if (password !== undefined) {
        if (password === '') await tx.setting.deleteMany({ where: { key: PASSWORD_KEY } });
        else await this.settings.setRaw(tx, PASSWORD_KEY, encryptSecret(password), actor.userId);
      }
      await this.audit.record(tx, {
        eventType: 'SETTING_CHANGED',
        actor,
        entityType: 'setting',
        entityId: CONFIG_KEY,
        entityRef: 'Serveur SMTP',
        summary: `Configuration e-mail (SMTP) modifiée${password !== undefined ? ' — mot de passe modifié' : ''}`,
        before: { ...before, password: '••••' },
        after: { ...before, ...rest, password: password !== undefined ? '•••• (modifié)' : '••••' },
      });
    });
    return this.publicConfig();
  }

  async transporter(): Promise<{ transporter: Transporter; config: StoredConfig }> {
    const config = await this.stored();
    if (!config.host)
      throw new AppError('EMAIL_DISABLED', undefined, { message: 'Serveur SMTP non configuré.' });
    const encrypted = await this.settings.getRaw<string>(PASSWORD_KEY);
    const password = encrypted ? decryptSecret(encrypted) : undefined;
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === 'SSL',
      requireTLS: config.security === 'STARTTLS',
      ignoreTLS: config.security === 'NONE',
      auth: config.username ? { user: config.username, pass: password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return { transporter, config };
  }

  private async markTested(actor: Actor, action: string): Promise<void> {
    const c = await this.stored();
    await this.prisma.tx(async (tx) => {
      await this.settings.setRaw(
        tx,
        CONFIG_KEY,
        {
          ...c,
          testedAt: now().toISOString(),
          testedFingerprint: fingerprint(c, await this.passwordVersion()),
        },
        actor.userId,
      );
      await this.audit.record(tx, {
        eventType: 'SETTING_CHANGED',
        actor,
        entityType: 'setting',
        entityId: CONFIG_KEY,
        entityRef: 'Serveur SMTP',
        summary: `${action} réussi(e) (${c.host}:${c.port})`,
        notify: false,
      });
    });
  }

  async testConnection(actor: Actor): Promise<{ ok: true; message: string }> {
    const { transporter } = await this.transporter();
    try {
      await transporter.verify();
    } catch (err) {
      throw new AppError(
        'SMTP_ERROR',
        { cause: (err as Error).message?.slice(0, 300) },
        { status: 400, message: smtpErrorMessage(err) },
      );
    } finally {
      transporter.close();
    }
    await this.markTested(actor, 'Test de connexion SMTP');
    return { ok: true, message: 'Connexion au serveur SMTP réussie.' };
  }

  async sendTest(
    to: string,
    rendered: { subject: string; html: string; text: string },
    actor: Actor,
  ): Promise<{ ok: true; messageId: string }> {
    const { transporter, config } = await this.transporter();
    try {
      const info = await transporter.sendMail({
        from: {
          name: config.fromName || 'PharmaStock',
          address: config.fromEmail || config.username,
        },
        replyTo: config.replyTo || undefined,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await this.markTested(actor, `Envoi d’un e-mail de test à ${to}`);
      return { ok: true, messageId: info.messageId };
    } catch (err) {
      throw new AppError(
        'SMTP_ERROR',
        { cause: (err as Error).message?.slice(0, 300) },
        { status: 400, message: smtpErrorMessage(err) },
      );
    } finally {
      transporter.close();
    }
  }
}
