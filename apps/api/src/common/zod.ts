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

/** PostgreSQL refuse le caractère NUL dans un texte : on le rejette dès l'entrée (400, pas 500). */
function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.some((v) => containsNul(v, depth + 1));
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  if (containsNul(value))
    throw new AppError('VALIDATION_ERROR', {
      fieldErrors: { _: 'Caractère non autorisé dans la saisie.' },
    });
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
