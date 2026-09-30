import { Injectable } from '@nestjs/common';
import { supplierSchema, type PaginationQuery } from '@pharmastock/shared';
import type { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { pageArgs, paginated } from '../../common/pagination.js';
import type { Actor } from '../../common/request-context.js';
import { normalizeSearch } from '../../common/search.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SequencesService } from '../sequences/sequences.service.js';

type SupplierData = z.output<typeof supplierSchema>;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequencesService,
  ) {}

  async list(q: PaginationQuery & { active?: string }) {
    const term = q.q ? normalizeSearch(q.q) : '';
    const where: Prisma.SupplierWhereInput = {
      ...(q.active === 'all' ? {} : { isActive: q.active !== 'false' }),
      ...(term ? { AND: term.split(' ').map((w) => ({ searchText: { contains: w } })) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(q),
        omit: { searchText: true },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  options() {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      omit: { searchText: true },
    });
    if (!supplier) throw new AppError('NOT_FOUND');
    const [receipts, lastReceipt] = await Promise.all([
      this.prisma.purchaseReceipt.aggregate({
        where: { supplierId: id, status: 'VALIDATED' },
        _count: true,
        _sum: { totalTtc: true },
      }),
      this.prisma.purchaseReceipt.findFirst({
        where: { supplierId: id, status: 'VALIDATED' },
        orderBy: { validatedAt: 'desc' },
        select: { number: true, validatedAt: true },
      }),
    ]);
    return {
      ...supplier,
      stats: { receiptCount: receipts._count, totalTtc: receipts._sum.totalTtc ?? 0n, lastReceipt },
    };
  }

  private columns(data: SupplierData) {
    return {
      name: data.name,
      taxId: data.taxId,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email,
      address: data.address,
      paymentTermsDays: data.paymentTermsDays,
      leadTimeDays: data.leadTimeDays ?? null,
      isActive: data.isActive,
      notes: data.notes,
    };
  }

  async create(data: SupplierData, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      let code = data.code;
      if (code) {
        if (await tx.supplier.findUnique({ where: { code } }))
          throw new AppError('DUPLICATE_CODE', { fieldErrors: { code: 'Code déjà utilisé' } });
      } else {
        do code = await this.sequences.nextCode(tx, 'SUP');
        while (await tx.supplier.findUnique({ where: { code } }));
      }
      const supplier = await tx.supplier.create({
        data: {
          ...this.columns(data),
          code,
          searchText: normalizeSearch(code, data.name, data.taxId, data.phone, data.contactName),
        },
        omit: { searchText: true },
      });
      await this.audit.record(tx, {
        eventType: 'SUPPLIER_CREATED',
        actor,
        entityType: 'supplier',
        entityId: supplier.id,
        entityRef: `${supplier.code} — ${supplier.name}`,
        summary: `Fournisseur ${supplier.code} — ${supplier.name} créé`,
        notify: false,
      });
      return supplier;
    });
  }

  async update(id: string, data: SupplierData, actor: Actor) {
    return this.prisma.tx(async (tx) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw new AppError('NOT_FOUND');
      if (data.version !== undefined && data.version !== before.version)
        throw new AppError('VERSION_CONFLICT');
      const supplier = await tx.supplier.update({
        where: { id },
        data: {
          ...this.columns(data),
          searchText: normalizeSearch(
            before.code,
            data.name,
            data.taxId,
            data.phone,
            data.contactName,
          ),
          version: { increment: 1 },
        },
        omit: { searchText: true },
      });
      await this.audit.record(tx, {
        eventType: 'SUPPLIER_UPDATED',
        actor,
        entityType: 'supplier',
        entityId: id,
        entityRef: `${supplier.code} — ${supplier.name}`,
        summary: `Fournisseur ${supplier.code} — ${supplier.name} modifié`,
        before: this.columns({
          ...before,
          email: before.email,
          code: before.code,
        } as unknown as SupplierData),
        after: this.columns(data),
        notify: false,
      });
      return supplier;
    });
  }
}
