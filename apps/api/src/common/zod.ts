import { Body, Param, ParseUUIDPipe, PipeTransform, Query } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from './app-error.js';

export function zodIssuesToDetails(error: z.ZodError): Record<string, unknown> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return { fieldErrors };
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('VALIDATION_ERROR', zodIssuesToDetails(result.error));
  return result.data;
}

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    return parseOrThrow(this.schema, value);
  }
}

/** Corps de requête validé par un schéma Zod partagé. */
export const ZBody = (schema: z.ZodType) => Body(new ZodPipe(schema));
/** Paramètres de requête validés par un schéma Zod. */
export const ZQuery = (schema: z.ZodType) => Query(new ZodPipe(schema));
/** Paramètre d'URL UUID. */
export const IdParam = (name = 'id') =>
  Param(name, new ParseUUIDPipe({ exceptionFactory: () => new AppError('NOT_FOUND') }));
