import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Un seul site en v1 ; `site_id` est néanmoins présent dans toutes les tables de stock. */
@Injectable()
export class SitesService {
  private cached: { id: string; name: string } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async defaultSite(): Promise<{ id: string; name: string }> {
    if (this.cached) return this.cached;
    const existing = await this.prisma.site.findFirst({ orderBy: { createdAt: 'asc' } });
    const site = existing ?? (await this.prisma.site.create({ data: { name: 'Site principal' } }));
    this.cached = { id: site.id, name: site.name };
    return this.cached;
  }
}
