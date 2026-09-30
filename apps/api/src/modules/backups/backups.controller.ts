import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentActor, RequirePermission } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam } from '../../common/zod.js';
import { AuditService } from '../audit/audit.service.js';
import { BackupService } from './backup.service.js';

/** Sauvegardes de la base (administrateur) : historique, lancement immédiat, téléchargement. */
@Controller('admin/backups')
export class BackupsController {
  constructor(
    private readonly backups: BackupService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('admin.backups')
  @Get()
  list() {
    return this.backups.list();
  }

  @RequirePermission('admin.backups')
  @Post()
  @HttpCode(200)
  async run(@CurrentActor() actor: Actor) {
    return this.backups.run('MANUAL', actor);
  }

  @RequirePermission('admin.backups')
  @Get(':id/download')
  async download(@IdParam() id: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const { path, filename } = await this.backups.fileOf(id);
    await this.audit.recordStandalone({
      eventType: 'BACKUP_DOWNLOADED',
      actor,
      entityType: 'backup',
      entityId: id,
      entityRef: filename,
      summary: `Sauvegarde ${filename} téléchargée`,
    });
    res.download(path, filename);
  }
}
