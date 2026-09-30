import { Injectable } from '@nestjs/common';
import type { CategoryInput, LaboratoryInput, TvaRateInput } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

type RefKind = 'category' | 'laboratory' | 'therapeuticClass' | 'tvaRate';
const LABELS: Record<RefKind, string> = {
  category: 'Catégorie',
  laboratory: 'Laboratoire',
  therapeuticClass: 'Famille thérapeutique',
  tvaRate: 'Taux de TVA',
};

/** Référentiels du catalogue : catégories, laboratoires, familles thérapeutiques, taux de TVA. */
@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async all() {
    const [categories, laboratories, therapeuticClasses, tvaRates] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.laboratory.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.therapeuticClass.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.tvaRate.findMany({
        orderBy: { rateBp: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
    ]);
    return { categories, laboratories, therapeuticClasses, tvaRates };
  }

  private async log(
    kind: RefKind,
    id: string,
    name: string,
    actor: Actor,
    action: string,
    before?: unknown,
    after?: unknown,
  ) {
    await this.prisma.tx(async (tx) =>
      this.audit.record(tx, {
        eventType: 'CATALOG_REFERENCE_CHANGED',
        actor,
        entityType: kind,
        entityId: id,
        entityRef: name,
        summary: `${LABELS[kind]} « ${name} » ${action}`,
        before,
        after,
        notify: false,
      }),
    );
  }

  async saveCategory(id: string | null, input: CategoryInput, actor: Actor) {
    const before = id ? await this.prisma.category.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError('NOT_FOUND');
    const row = id
      ? await this.prisma.category.update({ where: { id }, data: input })
      : await this.prisma.category.create({ data: input });
    await this.log('category', row.id, row.name, actor, id ? 'modifiée' : 'créée', before, row);
    return row;
  }

  async saveLaboratory(id: string | null, input: LaboratoryInput, actor: Actor) {
    const before = id ? await this.prisma.laboratory.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError('NOT_FOUND');
    const row = id
      ? await this.prisma.laboratory.update({ where: { id }, data: input })
      : await this.prisma.laboratory.create({ data: input });
    await this.log('laboratory', row.id, row.name, actor, id ? 'modifié' : 'créé', before, row);
    return row;
  }

  async saveTherapeuticClass(id: string | null, input: { name: string }, actor: Actor) {
    const row = id
      ? await this.prisma.therapeuticClass.update({ where: { id }, data: input })
      : await this.prisma.therapeuticClass.create({ data: input });
    await this.log('therapeuticClass', row.id, row.name, actor, id ? 'modifiée' : 'créée');
    return row;
  }

  async saveTvaRate(id: string | null, input: TvaRateInput, actor: Actor) {
    const before = id
      ? await this.prisma.tvaRate.findUnique({
          where: { id },
          include: { _count: { select: { products: true } } },
        })
      : null;
    if (id && !before) throw new AppError('NOT_FOUND');
    // Un taux utilisé ne change pas de valeur : les prix TTC saisis resteraient faux (créer un nouveau taux).
    if (before && before._count.products > 0 && before.rateBp !== input.rateBp) {
      throw new AppError('CONFLICT', undefined, {
        message:
          'Ce taux est utilisé par des produits : créez un nouveau taux puis réaffectez les produits.',
      });
    }
    const row = await this.prisma.tx(async (tx) => {
      if (input.isDefault)
        await tx.tvaRate.updateMany({
          where: { isDefault: true, NOT: { id: id ?? '' } },
          data: { isDefault: false },
        });
      return id
        ? tx.tvaRate.update({ where: { id }, data: input })
        : tx.tvaRate.create({ data: input });
    });
    await this.log('tvaRate', row.id, row.label, actor, id ? 'modifié' : 'créé', before, row);
    return row;
  }

  async remove(kind: RefKind, id: string, actor: Actor) {
    const delegate = {
      category: this.prisma.category,
      laboratory: this.prisma.laboratory,
      therapeuticClass: this.prisma.therapeuticClass,
      tvaRate: this.prisma.tvaRate,
    }[kind] as unknown as {
      findUnique(a: unknown): Promise<{
        id: string;
        name?: string;
        label?: string;
        _count: { products: number };
      } | null>;
      delete(a: unknown): Promise<unknown>;
    };
    const row = await delegate.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!row) throw new AppError('NOT_FOUND');
    if (row._count.products > 0) {
      throw new AppError('CONFLICT', undefined, {
        message: 'Élément utilisé par des produits : désactivez-le plutôt que de le supprimer.',
      });
    }
    await delegate.delete({ where: { id } });
    await this.log(kind, id, row.name ?? row.label ?? id, actor, 'supprimé(e)');
  }
}
