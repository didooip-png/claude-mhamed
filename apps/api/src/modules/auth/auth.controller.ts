import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  changePinSchema,
  loginSchema,
  switchUserSchema,
  unlockSchema,
  verifyPinSchema,
  type ChangePasswordInput,
  type LoginInput,
  type SwitchUserInput,
} from '@pharmastock/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { AllowPasswordChange, CurrentActor, Public, RequirePermission } from '../../common/decorators.js';
import { RequestContext, type Actor, type DeviceInfo } from '../../common/request-context.js';
import { IdParam, ZBody } from '../../common/zod.js';
import { loadConfig } from '../../config.js';
import { AuthService, type AuthResult } from './auth.service.js';

export const REFRESH_COOKIE = 'ps_refresh';
const COOKIE_PATH = '/api/v1/auth';

function device(): DeviceInfo {
  const d = RequestContext.get()?.device;
  if (!d) throw new AppError('DEVICE_UNKNOWN');
  return d;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private respond(res: Response, result: AuthResult) {
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        secure: loadConfig().cookieSecure,
        sameSite: 'strict',
        path: COOKIE_PATH,
        maxAge: 24 * 60 * 60 * 1000,
      });
    }
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@ZBody(loginSchema) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = RequestContext.get();
    const result = await this.auth.login(body, device(), ctx?.ip ?? null, req.header('user-agent') ?? null);
    return this.respond(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    return this.respond(res, await this.auth.refresh(token, device()));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('unlock')
  @HttpCode(200)
  async unlock(@ZBody(unlockSchema) body: { pin: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.unlock(token, body.pin, device(), RequestContext.get()?.ip ?? null);
    return this.respond(res, result);
  }

  @AllowPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @AllowPasswordChange()
  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor.userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('switch-user')
  @HttpCode(200)
  async switchUser(
    @CurrentActor() actor: Actor,
    @ZBody(switchUserSchema) body: SwitchUserInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.switchUser(actor, body, device(), req.header('user-agent') ?? null));
  }

  @Post('lock')
  @HttpCode(204)
  async lock(@CurrentActor() actor: Actor) {
    await this.auth.lock(actor);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-pin')
  @HttpCode(204)
  async verifyPin(@CurrentActor() actor: Actor, @ZBody(verifyPinSchema) body: { pin: string }) {
    await this.auth.confirmOwnPin(actor, body.pin);
  }

  @AllowPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentActor() actor: Actor, @ZBody(changePasswordSchema) body: ChangePasswordInput) {
    return this.auth.changePassword(actor, body);
  }

  @Post('change-pin')
  @HttpCode(204)
  async changePin(@CurrentActor() actor: Actor, @ZBody(changePinSchema) body: { currentPassword: string; newPin: string }) {
    await this.auth.changePin(actor, body.currentPassword, body.newPin);
  }

  @Post('totp/setup')
  @HttpCode(200)
  totpSetup(@CurrentActor() actor: Actor) {
    return this.auth.totpSetup(actor);
  }

  @Post('totp/enable')
  @HttpCode(204)
  async totpEnable(@CurrentActor() actor: Actor, @ZBody(z.object({ code: z.string().regex(/^\d{6}$/) })) body: { code: string }) {
    await this.auth.totpEnable(actor, body.code);
  }

  @Post('totp/disable')
  @HttpCode(204)
  async totpDisable(@CurrentActor() actor: Actor, @ZBody(z.object({ currentPassword: z.string().min(1) })) body: { currentPassword: string }) {
    await this.auth.totpDisable(actor, body.currentPassword);
  }

  @RequirePermission('admin.users')
  @Get('sessions')
  sessions() {
    return this.auth.listActiveSessions();
  }

  @RequirePermission('admin.users')
  @Post('sessions/:id/revoke')
  @HttpCode(204)
  async revoke(@IdParam() id: string, @CurrentActor() actor: Actor) {
    await this.auth.revokeSession(id, actor);
  }
}
