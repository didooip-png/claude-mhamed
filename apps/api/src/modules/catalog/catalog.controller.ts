import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  categorySchema,
  laboratorySchema,
  productQuerySchema,
  productSchema,
  therapeuticClassSchema,
  tvaRateSchema,
  type CategoryInput,
  type LaboratoryInput,
  type ProductData,
  type ProductQuery,
  type TvaRateInput,
} from '@pharmastock/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam, ZBody, ZQuery } from '../../common/zod.js';
import { CatalogImportService } from './catalog-import.service.js';
import { ProductsService } from './products.service.js';
import { ReferencesService } from './references.service.js';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly importer: CatalogImportService,
  ) {}

  @RequirePermission('catalog.view')
  @Get()
  list(@ZQuery(productQuerySchema) q: ProductQuery, @CurrentActor() actor: Actor) {
    return this.products.list(q, actor);
  }

  /** Recherche instantanée (nom, DCI, code, code-barres) — caisse, réception, inventaire. */
  @RequirePermission('catalog.view')
  @Get('search')
  search(
    @ZQuery(z.object({ q: z.string().max(100).default(''), all: z.enum(['0', '1']).default('0') }))
    q: { q: string; all: '0' | '1' },
    @CurrentActor() actor: Actor,
  ) {
    return this.products.search(q.q, actor, { includeInactive: q.all === '1' });
  }

  @RequirePermission('catalog.manage')
  @Get('export')
  async export(@CurrentActor() actor: Actor, @Res() res: Response) {
    const buffer = await this.importer.export(actor);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="catalogue-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    );
    res.send(buffer);
  }

  /** Import Excel / CSV avec rapport d'erreurs ligne par ligne (`dryRun=1` : simulation). */
  @RequirePermission('catalog.manage')
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    if (!file) throw new AppError('VALIDATION_ERROR', undefined, { message: 'Fichier manquant.' });
    return this.importer.import(file.buffer, file.originalname, dryRun !== '0', actor);
  }

  @RequirePermission('catalog.view')
  @Get(':id')
  get(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.products.get(id, actor);
  }

  @RequirePermission('catalog.view')
  @Get(':id/equivalents')
  equivalents(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.products.equivalents(id, actor);
  }

  @RequirePermission('catalog.view')
  @Get(':id/price-history')
  priceHistory(@IdParam() id: string, @CurrentActor() actor: Actor) {
    return this.products.priceHistory(id, actor);
  }

  @RequirePermission('catalog.manage')
  @Post()
  create(@ZBody(productSchema) body: ProductData, @CurrentActor() actor: Actor) {
    return this.products.create(body, actor);
  }

  @RequirePermission('catalog.manage')
  @Put(':id')
  update(
    @IdParam() id: string,
    @ZBody(productSchema) body: ProductData,
    @CurrentActor() actor: Actor,
  ) {
    return this.products.update(id, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Delete(':id')
  @HttpCode(204)
  async remove(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.products.remove(id, actor);
  }
}

@Controller('catalog')
export class CatalogReferencesController {
  constructor(private readonly refs: ReferencesService) {}

  @RequirePermission('catalog.view')
  @Get('references')
  all() {
    return this.refs.all();
  }

  @RequirePermission('catalog.manage')
  @Post('categories')
  createCategory(@ZBody(categorySchema) body: CategoryInput, @CurrentActor() actor: Actor) {
    return this.refs.saveCategory(null, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Put('categories/:id')
  updateCategory(
    @IdParam() id: string,
    @ZBody(categorySchema) body: CategoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.refs.saveCategory(id, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Post('laboratories')
  createLab(@ZBody(laboratorySchema) body: LaboratoryInput, @CurrentActor() actor: Actor) {
    return this.refs.saveLaboratory(null, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Put('laboratories/:id')
  updateLab(
    @IdParam() id: string,
    @ZBody(laboratorySchema) body: LaboratoryInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.refs.saveLaboratory(id, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Post('therapeutic-classes')
  createClass(@ZBody(therapeuticClassSchema) body: { name: string }, @CurrentActor() actor: Actor) {
    return this.refs.saveTherapeuticClass(null, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Put('therapeutic-classes/:id')
  updateClass(
    @IdParam() id: string,
    @ZBody(therapeuticClassSchema) body: { name: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.refs.saveTherapeuticClass(id, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Post('tva-rates')
  createTva(@ZBody(tvaRateSchema) body: TvaRateInput, @CurrentActor() actor: Actor) {
    return this.refs.saveTvaRate(null, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Put('tva-rates/:id')
  updateTva(
    @IdParam() id: string,
    @ZBody(tvaRateSchema) body: TvaRateInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.refs.saveTvaRate(id, body, actor);
  }

  @RequirePermission('catalog.manage')
  @Delete('categories/:id')
  @HttpCode(204)
  async removeCategory(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.refs.remove('category', id, actor);
  }

  @RequirePermission('catalog.manage')
  @Delete('laboratories/:id')
  @HttpCode(204)
  async removeLab(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.refs.remove('laboratory', id, actor);
  }

  @RequirePermission('catalog.manage')
  @Delete('therapeutic-classes/:id')
  @HttpCode(204)
  async removeClass(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.refs.remove('therapeuticClass', id, actor);
  }

  @RequirePermission('catalog.manage')
  @Delete('tva-rates/:id')
  @HttpCode(204)
  async removeTva(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.refs.remove('tvaRate', id, actor);
  }
}
