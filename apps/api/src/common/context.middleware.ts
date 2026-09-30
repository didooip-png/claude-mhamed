import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context.js';

/** Ouvre le contexte de requête (identifiant, IP, user-agent) pour toute la durée du traitement. */
export function contextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  RequestContext.run(
    { requestId, ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null },
    () => next(),
  );
}
