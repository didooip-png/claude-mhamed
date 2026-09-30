import type { Paginated, PaginationQuery } from '@pharmastock/shared';

export function pageArgs(q: Pick<PaginationQuery, 'page' | 'pageSize'>) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paginated<T>(items: T[], total: number, q: Pick<PaginationQuery, 'page' | 'pageSize'>): Paginated<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Transforme « field:asc » en orderBy Prisma, limité à une liste blanche. */
export function orderBy<T extends string>(
  sort: string | undefined,
  allowed: readonly T[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  if (!(allowed as readonly string[]).includes(field)) return fallback;
  return { [field]: dir };
}
