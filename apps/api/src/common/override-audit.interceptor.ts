import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, throwError, type Observable } from 'rxjs';
import { AuditService } from '../modules/audit/audit.service.js';
import { AppError } from './app-error.js';
import { currentActor } from './decorators.js';

/**
 * Trace les échecs d'autorisation administrateur (🔑) APRÈS l'annulation de la transaction
 * métier, pour que l'entrée OVERRIDE_FAILED ne soit pas perdue avec elle.
 */
@Injectable()
export class OverrideAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (!(err instanceof AppError) || err.code !== 'OVERRIDE_INVALID') return throwError(() => err);
        const actor = currentActor();
        const details = err.details ?? {};
        return from(
          this.audit.recordStandalone({
            eventType: 'OVERRIDE_FAILED',
            actor,
            summary: `Échec d’autorisation administrateur demandée par ${actor.userCode} (code saisi : ${String(details.userCode ?? '?')})`,
            metadata: { requirements: details.requirements, cause: details.cause },
          }),
        ).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}
