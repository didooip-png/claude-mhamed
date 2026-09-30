import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pharmastock/shared';
import type { Request } from 'express';
import { AuthService } from '../modules/auth/auth.service.js';
import { DevicesService } from '../modules/devices/devices.service.js';
import { AppError } from './app-error.js';
import {
  ALLOW_PASSWORD_CHANGE,
  ALLOW_PENDING_DEVICE,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  SKIP_DEVICE,
} from './decorators.js';
import { RequestContext } from './request-context.js';

/**
 * Garde globale, dans cet ordre : poste (X-Device-Id / X-Device-Token) → authentification
 * (jeton d'accès) → permissions. Toute règle d'accès est appliquée ici, côté serveur.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly devices: DevicesService,
    private readonly auth: AuthService,
  ) {}

  private meta<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = RequestContext.get();
    if (!ctx) throw new AppError('INTERNAL_ERROR');

    if (!this.meta<boolean>(SKIP_DEVICE, context)) {
      const device = await this.devices.resolve(
        req.header('x-device-id'),
        req.header('x-device-token'),
        ctx.ip,
      );
      ctx.device = device;
      if (device.status === 'PENDING' && !this.meta<boolean>(ALLOW_PENDING_DEVICE, context)) {
        throw new AppError('DEVICE_PENDING');
      }
    }

    if (this.meta<boolean>(IS_PUBLIC, context)) return true;

    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError('UNAUTHENTICATED');
    const user = await this.auth.authenticate(
      token,
      ctx.device,
      req.header('x-background') === '1',
    );
    ctx.user = user;

    if (user.mustChangePassword && !this.meta<boolean>(ALLOW_PASSWORD_CHANGE, context)) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED');
    }

    const required = this.meta<Permission[]>(REQUIRED_PERMISSIONS, context) ?? [];
    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length > 0) throw new AppError('FORBIDDEN', { permissions: missing });
    return true;
  }
}
