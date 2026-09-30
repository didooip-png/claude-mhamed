import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public, SkipDevice } from '../../common/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Santé de l'API et de la base de données. */
  @Public()
  @SkipDevice()
  @Get()
  async health() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new HttpException(
        { status: 'error', database: 'unreachable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: 'ok',
      database: 'ok',
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    };
  }
}
