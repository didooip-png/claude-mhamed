import { Injectable } from '@nestjs/common';
import { clientSchema, quickClientSchema, type PaginationQuery } from '@pharmastock/shared';
import type { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { now } from '../../common/clock.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { normalizeSearch } from '../../common/search.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SequencesService } from '../sequences/sequences.service.js';

type ClientData = z.output<typeof clientSchema>;
type QuickClientData = z.output<typeof quickClientSchema>;

const PROFESSIONAL_TYPES = new Set(['PHARMACY', 'CLINIC', 'HOSPITAL', 'ASSOCIATION', 'COMPANY']);
export const isProfessionalClient = (type: string) => PROFESSIONAL_TYPES.has(type);

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
  ) {}

  private searchText(
    code: string,
    d: {
      name: string;
      phone?: string | null;
      phone2?: string | null;
      nationalIdOrTaxId?: string | null;
      email?: string | null;
    },
  ) {
    return normalizeSearch(code, d.name, d.phone, d.phone2, d.nationalIdOrTaxId, d.email);
  }

  async list(q: PaginationQuery & { active?: string; type?: string; balance?: string }) {
    const term = q.q ? normalizeSearch(q.q) : '';
    const where: Prisma.ClientWhereInput = {
      isWalkIn: false,
      ...(q.active === 'all' ? {} : { isActive: q.active !== 'false' }),
      ...(q.type ? { type: q.type as Prisma.ClientWhereInput['type'] } : {}),
      ...(q.balance === 'debt'
        ? { balance: { gt: 0 } }
        : q.balance === 'credit'
          ? { balance: { lt: 0 } }
          : {}),
      ...(term ? { AND: term.split(' ').map((w) => ({ searchText: { contains: w } })) } : {}),
    };
    const [field, dir] = (q.sort ?? 'name:asc').split(':') as [string, 'asc' | 'desc'];
    const orderBy: Prisma.ClientOrderByWithRelationInput = [
      'name',
      'code',
      'balance',
      'createdAt',
    ].includes(field)
      ? { [field]: dir }
      : { name: 'asc' };
    const [items, total] = await Promise.all([
      this.prisma.client.findMany({ where, orderBy, ...pageArgs(q), omit: { searchText: true } }),
      this.prisma.client.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  /** Recherche rapide (caisse) : nom, code, téléphone, CIN / matricule fiscal. */
  async search(raw: string) {
    const term = normalizeSearch(raw);
    if (!term) return [];
    return this.prisma.client.findMany({
      where: {
        isActive: true,
        isWalkIn: false,
        AND: term.split(' ').map((w) => ({ searchText: { contains: w } })),
      },
      orderBy: { name: 'asc' },
      take: 15,
      omit: { searchText: true },
    });
  }

  async get(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      omit: { searchText: true },
    });
    if (!client) throw new AppError('NOT_FOUND');
    return client;
  }

  /** Client « comptoir » (si activé) : client système unique, jamais de crédit ni d'avoir. */
  async walkInClient(tx: Tx): Promise<{ id: string }> {
    const existing = await tx.client.findFirst({ where: { isWalkIn: true } });
    if (existing) return existing;
    return tx.client.create({
      data: {
        code: 'COMPTOIR',
        name: 'Client comptoir',
        type: 'INDIVIDUAL',
        isWalkIn: true,
        searchText: 'comptoir client comptoir',
      },
    });
  }

  private columns(data: ClientData) {
    return {
      type: data.type,
      name: data.name,
      nationalIdOrTaxId: data.nationalIdOrTaxId,
      phone: data.phone,
      phone2: data.phone2,
      email: data.email,
      address: data.address,
      paymentTermsDays: data.paymentTermsDays,
      isActive: data.isActive,
      notes: data.notes,
      emailCc: data.emailCc,
      ...(data.emailDocPrefs ? { emailDocPrefs: data.emailDocPrefs } : {}),
    };
  }

  async create(data: ClientData, actor: Actor) {
    const canCredit = actor.permissions.has('clients.edit_credit');
    return this.prisma.tx(async (tx) => {
      let code: string;
      do code = await this.sequences.nextCode(tx, 'CLI');
      while (await tx.client.findUnique({ where: { code } }));
      const client = await tx.client.create({
        data: {
          ...this.columns(data),
          code,
          creditLimit: canCredit ? BigInt(data.creditLimit) : 0n,
          defaultDiscountBp: canCredit ? data.defaultDiscountBp : 0,
          emailConsent: !!data.email && data.emailConsent,
          emailConsentAt: data.email && data.emailConsent ? now() : null,
          emailConsentById: data.email && data.emailConsent ? actor.userId : null,
          searchText: this.searchText(code, data),
          createdById: actor.userId,
        },
        omit: { searchText: true },
      });
      await this.audit.record(tx, {
        eventType: 'CLIENT_CREATED',
        actor,
        entityType: 'client',
        entityId: client.id,
        entityRef: `${client.code} — ${client.name}`,
        summary: `Client ${client.code} — ${client.name} créé${client.emailConsent ? ' (consentement e-mail enregistré)' : ''}`,
        notify: false,
      });
      return client;
    });
  }

  async quickCreate(data: QuickClientData, actor: Actor) {
    return this.create(
      {
        ...data,
        phone2: null,
        address: null,
        creditLimit: 0,
        defaultDiscountBp: 0,
        paymentTermsDays: 0,
        isActive: true,
        notes: null,
        emailCc: [],
        nationalIdOrTaxId: data.nationalIdOrTaxId ?? null,
        email: data.email ?? null,
      },
      actor,
    );
  }

  async update(id: string, data: ClientData, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const before = await tx.client.findUnique({ where: { id } });
      if (!before || before.isWalkIn) throw new AppError('NOT_FOUND');
      if (data.version !== undefined && data.version !== before.version)
        throw new AppError('VERSION_CONFLICT');
      const creditChanged =
        BigInt(data.creditLimit) !== before.creditLimit ||
        data.defaultDiscountBp !== before.defaultDiscountBp;
      if (creditChanged && !actor.permissions.has('clients.edit_credit')) {
        throw new AppError(
          'FORBIDDEN',
          { permissions: ['clients.edit_credit'] },
          {
            message:
              'Seul un administrateur peut modifier le plafond de crédit ou la remise habituelle.',
          },
        );
      }
      const consent = !!(data.email ?? before.email) && data.emailConsent;
      const consentChanged = consent !== before.emailConsent;
      const client = await tx.client.update({
        where: { id },
        data: {
          ...this.columns(data),
          creditLimit: BigInt(data.creditLimit),
          defaultDiscountBp: data.defaultDiscountBp,
          emailConsent: consent,
          ...(consentChanged ? { emailConsentAt: now(), emailConsentById: actor.userId } : {}),
          ...(data.email !== before.email ? { emailBounced: false } : {}),
          searchText: this.searchText(before.code, data),
          version: { increment: 1 },
        },
        omit: { searchText: true },
      });
      const ref = `${client.code} — ${client.name}`;
      await this.audit.record(tx, {
        eventType: 'CLIENT_UPDATED',
        actor,
        entityType: 'client',
        entityId: id,
        entityRef: ref,
        summary: `Client ${ref} modifié${creditChanged ? ' (plafond / remise)' : ''}`,
        before: {
          name: before.name,
          phone: before.phone,
          email: before.email,
          creditLimit: before.creditLimit,
          defaultDiscountBp: before.defaultDiscountBp,
          isActive: before.isActive,
        },
        after: {
          name: client.name,
          phone: client.phone,
          email: client.email,
          creditLimit: client.creditLimit,
          defaultDiscountBp: client.defaultDiscountBp,
          isActive: client.isActive,
        },
        notify: false,
      });
      if (consentChanged) {
        await this.audit.record(tx, {
          eventType: 'CLIENT_EMAIL_CONSENT_CHANGED',
          actor,
          entityType: 'client',
          entityId: id,
          entityRef: ref,
          summary: `Consentement e-mail de ${ref} ${consent ? 'donné' : 'retiré'}`,
          notify: false,
        });
      }
      return client;
    });
  }

  isProfessional = isProfessionalClient;
}
