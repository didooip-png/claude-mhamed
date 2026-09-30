import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { errorMessage, type ApiErrorBody } from '@pharmastock/shared';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from './app-error.js';
import { RequestContext } from './request-context.js';

/** Traduit une erreur de base de données en erreur métier lorsque c'est possible. */
export function mapDatabaseError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = JSON.stringify(err.meta ?? {});
      if (target.includes('barcode')) return new AppError('DUPLICATE_BARCODE', { target: err.meta?.target });
      return new AppError('DUPLICATE_CODE', { target: err.meta?.target });
    }
    if (err.code === 'P2025') return new AppError('NOT_FOUND');
    if (err.code === 'P2034') return new AppError('CONFLICT', { reason: 'serialization' });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('lots_remaining_qty_non_negative') || message.includes('stock_movements_balances_non_negative')) {
    return new AppError('STOCK_INSUFFICIENT');
  }
  if (message.includes('sales_amounts')) return new AppError('ALLOCATION_EXCEEDS_DUE');
  if (message.includes('credit_notes_amounts')) return new AppError('CREDIT_BALANCE_INSUFFICIENT');
  if (message.includes('payments_amounts')) return new AppError('ALLOCATION_EXCEEDS_PAYMENT');
  if (message.includes('cash_sessions_one_open_per_device')) return new AppError('CASH_SESSION_ALREADY_OPEN');
  return null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.get()?.requestId;
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = { code: 'INTERNAL_ERROR', message: errorMessage('INTERNAL_ERROR') };

    const mapped = exception instanceof AppError ? exception : mapDatabaseError(exception);
    if (mapped) {
      status = mapped.status;
      body = { code: mapped.code, message: mapped.message, details: mapped.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code =
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 429
                ? 'RATE_LIMITED'
                : status === 400 || status === 413
                  ? 'VALIDATION_ERROR'
                  : 'INTERNAL_ERROR';
      body = { code, message: errorMessage(code) };
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Erreur non gérée');
    }
    if (requestId) body.details = { ...(body.details ?? {}), requestId };
    res.status(status).json(body);
  }
}
