import { Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentActor } from '../../common/decorators.js';
import type { Actor } from '../../common/request-context.js';
import { IdParam } from '../../common/zod.js';
import { AttachmentsService, MAX_ATTACHMENT_BYTES } from './attachments.service.js';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @CurrentActor() actor: Actor) {
    const a = await this.attachments.store(file, actor);
    return { id: a.id, filename: a.filename, mime: a.mime, size: a.size };
  }

  @Get(':id')
  async download(@IdParam() id: string, @Res() res: Response) {
    const file = await this.attachments.read(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(file.data);
  }
}
