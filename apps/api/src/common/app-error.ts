import { HttpStatus } from '@nestjs/common';
import { errorMessage, type ErrorCode } from '@pharmastock/shared';

const DEFAULT_STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_PIN: HttpStatus.UNAUTHORIZED,
  ACCOUNT_LOCKED: HttpStatus.FORBIDDEN,
  ACCOUNT_DISABLED: HttpStatus.FORBIDDEN,
  PASSWORD_CHANGE_REQUIRED: HttpStatus.FORBIDDEN,
  TOTP_REQUIRED: HttpStatus.UNAUTHORIZED,
  TOTP_INVALID: HttpStatus.UNAUTHORIZED,
  SCREEN_LOCKED: HttpStatus.FORBIDDEN,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  OVERRIDE_REQUIRED: HttpStatus.FORBIDDEN,
  OVERRIDE_INVALID: HttpStatus.FORBIDDEN,
  DEVICE_UNKNOWN: HttpStatus.FORBIDDEN,
  DEVICE_PENDING: HttpStatus.FORBIDDEN,
  DEVICE_REVOKED: HttpStatus.FORBIDDEN,
  VERSION_CONFLICT: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  DUPLICATE_CODE: HttpStatus.CONFLICT,
  DUPLICATE_BARCODE: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Erreur métier typée, traduite en { code, message, details }. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    options: { status?: number; message?: string } = {},
  ) {
    super(options.message ?? errorMessage(code));
    this.status = options.status ?? DEFAULT_STATUS[code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
  }
}

export function notFound(entity?: string): AppError {
  return new AppError('NOT_FOUND', entity ? { entity } : undefined);
}
