import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ALL_PERMISSIONS,
  checkPasswordPolicy,
  isPermission,
  type ChangePasswordInput,
  type LoginInput,
  type Permission,
  type SwitchUserInput,
} from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  randomToken,
  sha256Hex,
  verifyTotp,
} from '../../common/crypto.js';
import type { Actor, AuthUser, DeviceInfo } from '../../common/request-context.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PasswordService } from './password.service.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_REUSE_GRACE_MS = 30_000;
const AUTH_CACHE_TTL_MS = 5_000;
const LAST_SEEN_WRITE_INTERVAL_MS = 30_000;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  did: string;
}

export interface MeDto {
  id: string;
  code: string;
  username: string;
  fullName: string;
  email: string | null;
  role: { id: string; name: string; isAdmin: boolean };
  permissions: Permission[];
  mustChangePassword: boolean;
  totpEnabled: boolean;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
  user: MeDto;
}

type UserWithRole = Awaited<ReturnType<AuthService['findUserWithRole']>>;

interface CachedSession {
  user: AuthUser;
  deviceId: string | null;
  loadedAt: number;
  lastSeenAt: number;
  lockedAt: Date | null;
}

@Injectable()
export class AuthService {
  private readonly cache = new Map<string, CachedSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly devices: DevicesService,
  ) {}

  // -------------------------------------------------------------------------
  // Chargement de l'utilisateur authentifié (guard)
  // -------------------------------------------------------------------------

  private findUserWithRole(where: { id: string } | { username: string } | { code: string }) {
    return this.prisma.user.findFirst({
      where,
      include: { role: { include: { permissions: true } } },
    });
  }

  private permissionsOf(user: NonNullable<UserWithRole>): Permission[] {
    if (user.role.systemKey === 'ADMIN') return [...ALL_PERMISSIONS];
    return user.role.permissions.map((p) => p.permissionKey).filter(isPermission);
  }

  toMe(user: NonNullable<UserWithRole>): MeDto {
    return {
      id: user.id,
      code: user.code,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: { id: user.role.id, name: user.role.name, isAdmin: user.role.systemKey === 'ADMIN' },
      permissions: this.permissionsOf(user),
      mustChangePassword: user.mustChangePassword,
      totpEnabled: user.totpEnabled,
    };
  }

  invalidateCache(sessionId?: string): void {
    if (sessionId) this.cache.delete(sessionId);
    else this.cache.clear();
  }

  /** Vérifie le jeton d'accès et renvoie l'utilisateur (session active, poste cohérent, écran non verrouillé). */
  async authenticate(
    token: string,
    device: DeviceInfo | undefined,
    background: boolean,
  ): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
    if (device && payload.did !== device.id) throw new AppError('UNAUTHENTICATED');

    const now = Date.now();
    let cached = this.cache.get(payload.sid);
    if (!cached || now - cached.loadedAt > AUTH_CACHE_TTL_MS) {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        include: { user: { include: { role: { include: { permissions: true } } } } },
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt.getTime() < now ||
        session.absoluteExpiresAt.getTime() < now ||
        !session.user.isActive
      ) {
        this.cache.delete(payload.sid);
        throw new AppError('UNAUTHENTICATED');
      }
      const u = session.user;
      cached = {
        user: {
          id: u.id,
          code: u.code,
          fullName: u.fullName,
          roleId: u.roleId,
          roleName: u.role.name,
          isAdminRole: u.role.systemKey === 'ADMIN',
          permissions: new Set(this.permissionsOf(u)),
          sessionId: session.id,
          mustChangePassword: u.mustChangePassword,
        },
        deviceId: session.deviceId,
        loadedAt: now,
        lastSeenAt: session.lastSeenAt.getTime(),
        lockedAt: session.lockedAt,
      };
      this.cache.set(payload.sid, cached);
    }
    if (cached.lockedAt) throw new AppError('SCREEN_LOCKED');

    // Verrouillage d'inactivité appliqué côté serveur (les requêtes d'arrière-plan ne comptent pas).
    const inactivityMinutes = await this.settings.get('security.inactivity_lock_minutes');
    if (inactivityMinutes > 0 && now - cached.lastSeenAt > inactivityMinutes * 60_000) {
      await this.prisma.session.update({
        where: { id: payload.sid },
        data: { lockedAt: new Date() },
      });
      this.cache.delete(payload.sid);
      throw new AppError('SCREEN_LOCKED');
    }
    if (!background && now - cached.lastSeenAt > LAST_SEEN_WRITE_INTERVAL_MS) {
      cached.lastSeenAt = now;
      await this.prisma.session.update({
        where: { id: payload.sid },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return cached.user;
  }

  // -------------------------------------------------------------------------
  // Connexion
  // -------------------------------------------------------------------------

  async login(
    input: LoginInput,
    device: DeviceInfo,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthResult> {
    const settings = await this.settings.all();
    const user = await this.findUserWithRole({ username: input.username.trim().toLowerCase() });
    const deviceRef = { id: device.id, name: device.name };

    if (!user) {
      await this.passwords.verify(null, input.password);
      await this.audit.recordStandalone({
        eventType: 'LOGIN_FAILED',
        device: deviceRef,
        ip,
        summary: `Échec de connexion : identifiant inconnu « ${input.username.slice(0, 60)} »`,
        metadata: { username: input.username.slice(0, 60), reason: 'UNKNOWN_USER' },
      });
      throw new AppError('INVALID_CREDENTIALS');
    }
    const userRef = { id: user.id, code: user.code, name: user.fullName };

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.recordStandalone({
        eventType: 'LOGIN_FAILED',
        user: userRef,
        device: deviceRef,
        ip,
        summary: `Tentative de connexion de ${user.code} : compte verrouillé`,
        metadata: { reason: 'LOCKED' },
      });
      throw new AppError('ACCOUNT_LOCKED', { lockedUntil: user.lockedUntil.toISOString() });
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.registerFailure(
        user,
        'password',
        deviceRef,
        ip,
        settings['security.max_failed_attempts'],
        settings['security.lock_duration_minutes'],
      );
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      await this.audit.recordStandalone({
        eventType: 'LOGIN_FAILED',
        user: userRef,
        device: deviceRef,
        ip,
        summary: `Tentative de connexion de ${user.code} : compte désactivé`,
        metadata: { reason: 'DISABLED' },
      });
      throw new AppError('ACCOUNT_DISABLED');
    }
    if (user.totpEnabled && user.totpSecret) {
      if (!input.totp) throw new AppError('TOTP_REQUIRED');
      if (!verifyTotp(decryptSecret(user.totpSecret), input.totp)) {
        await this.registerFailure(
          user,
          'totp',
          deviceRef,
          ip,
          settings['security.max_failed_attempts'],
          settings['security.lock_duration_minutes'],
        );
        throw new AppError('TOTP_INVALID');
      }
    }

    // Poste en attente : refusé, sauf amorçage (aucun poste approuvé) par un administrateur.
    if (device.status === 'PENDING') {
      const isAdmin = user.role.systemKey === 'ADMIN';
      if (isAdmin && !(await this.devices.hasApprovedDevice())) {
        await this.devices.setStatus(
          device.id,
          'APPROVED',
          this.systemActor(user, device, ip),
          true,
        );
      } else {
        await this.audit.recordStandalone({
          eventType: 'LOGIN_FAILED',
          user: userRef,
          device: deviceRef,
          ip,
          summary: `Connexion de ${user.code} refusée : poste « ${device.name} » en attente d’approbation`,
          metadata: { reason: 'DEVICE_PENDING' },
        });
        throw new AppError('DEVICE_PENDING');
      }
    }

    return this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: 0,
          pinFailedAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      const result = await this.createSession(tx, user, device.id, ip, userAgent);
      await this.audit.record(tx, {
        eventType: 'LOGIN_SUCCESS',
        user: userRef,
        device: deviceRef,
        ip,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `Connexion de ${user.code} — ${user.fullName}`,
        metadata: { sessionId: result.sessionId },
      });
      return result.auth;
    });
  }

  private systemActor(
    user: NonNullable<UserWithRole>,
    device: DeviceInfo,
    ip: string | null,
  ): Actor {
    return {
      userId: user.id,
      userCode: user.code,
      userName: user.fullName,
      permissions: new Set(this.permissionsOf(user)),
      isAdmin: user.role.systemKey === 'ADMIN',
      deviceId: device.id,
      deviceName: device.name,
      siteId: device.siteId,
      ip,
    };
  }

  private async registerFailure(
    user: NonNullable<UserWithRole>,
    kind: 'password' | 'totp' | 'pin',
    device: { id: string; name: string } | null,
    ip: string | null,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<void> {
    const field = kind === 'pin' ? 'pinFailedAttempts' : 'failedAttempts';
    await this.prisma.tx(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { [field]: { increment: 1 } },
        select: { failedAttempts: true, pinFailedAttempts: true },
      });
      const attempts = kind === 'pin' ? updated.pinFailedAttempts : updated.failedAttempts;
      const userRef = { id: user.id, code: user.code, name: user.fullName };
      const label =
        kind === 'pin'
          ? 'PIN'
          : kind === 'totp'
            ? 'code de double authentification'
            : 'mot de passe';
      await this.audit.record(tx, {
        eventType: kind === 'pin' ? 'PIN_FAILED' : 'LOGIN_FAILED',
        user: userRef,
        device,
        ip,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `Échec (${label} incorrect) pour ${user.code} — tentative ${attempts}/${maxAttempts}`,
        metadata: { reason: kind.toUpperCase(), attempts },
      });
      if (attempts >= maxAttempts) {
        const lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
        await tx.user.update({
          where: { id: user.id },
          data: { lockedUntil, failedAttempts: 0, pinFailedAttempts: 0 },
        });
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Compte verrouillé' },
        });
        await this.audit.record(tx, {
          eventType: 'ACCOUNT_LOCKED',
          user: userRef,
          device,
          ip,
          entityType: 'user',
          entityId: user.id,
          entityRef: user.code,
          summary: `Compte ${user.code} verrouillé ${lockMinutes} min après ${attempts} échecs`,
          metadata: { lockedUntil: lockedUntil.toISOString() },
        });
      }
    });
    this.invalidateCache();
  }

  private async createSession(
    tx: Tx,
    user: NonNullable<UserWithRole>,
    deviceId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ sessionId: string; auth: AuthResult }> {
    const refreshToken = randomToken(48);
    const now = Date.now();
    const session = await tx.session.create({
      data: {
        userId: user.id,
        deviceId,
        refreshTokenHash: sha256Hex(refreshToken),
        ip,
        userAgent: userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(now + REFRESH_TTL_MS),
        absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
      },
    });
    const accessToken = await this.signAccess(user.id, session.id, deviceId);
    return {
      sessionId: session.id,
      auth: {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken,
        user: this.toMe(user),
      },
    };
  }

  private signAccess(userId: string, sessionId: string, deviceId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, did: deviceId };
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  // -------------------------------------------------------------------------
  // Renouvellement (rotation du refresh token)
  // -------------------------------------------------------------------------

  private async findSessionForRefresh(refreshToken: string | undefined, device: DeviceInfo) {
    if (!refreshToken) throw new AppError('UNAUTHENTICATED');
    const hash = sha256Hex(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (session) {
      if (
        session.revokedAt ||
        session.expiresAt.getTime() < Date.now() ||
        session.absoluteExpiresAt.getTime() < Date.now()
      ) {
        throw new AppError('UNAUTHENTICATED');
      }
      if (session.deviceId !== device.id) throw new AppError('UNAUTHENTICATED');
      return { session, reused: false };
    }
    // Jeton déjà utilisé : toléré quelques secondes (onglets simultanés), sinon vol présumé → révocation.
    const previous = await this.prisma.session.findFirst({ where: { previousTokenHash: hash } });
    if (previous && !previous.revokedAt) {
      if (
        Date.now() - previous.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS &&
        previous.deviceId === device.id
      ) {
        return { session: previous, reused: true };
      }
      await this.prisma.tx(async (tx) => {
        await tx.session.update({
          where: { id: previous.id },
          data: {
            revokedAt: new Date(),
            revokedReason: 'Réutilisation d’un jeton de renouvellement',
          },
        });
        await this.audit.record(tx, {
          eventType: 'SESSION_REVOKED',
          user: { id: previous.userId, code: null, name: null },
          device: { id: device.id, name: device.name },
          entityType: 'session',
          entityId: previous.id,
          summary:
            'Session révoquée : réutilisation d’un jeton de renouvellement (vol de session présumé)',
        });
      });
      this.invalidateCache(previous.id);
    }
    throw new AppError('UNAUTHENTICATED');
  }

  async refresh(refreshToken: string | undefined, device: DeviceInfo): Promise<AuthResult> {
    const { session, reused } = await this.findSessionForRefresh(refreshToken, device);
    if (session.lockedAt) throw new AppError('SCREEN_LOCKED');
    const user = await this.findUserWithRole({ id: session.userId });
    if (!user || !user.isActive) throw new AppError('UNAUTHENTICATED');
    if (reused) {
      return {
        accessToken: await this.signAccess(user.id, session.id, device.id),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: null,
        user: this.toMe(user),
      };
    }
    return this.rotate(session.id, session.refreshTokenHash, user, device.id);
  }

  private async rotate(
    sessionId: string,
    currentHash: string,
    user: NonNullable<UserWithRole>,
    deviceId: string,
  ): Promise<AuthResult> {
    const refreshToken = randomToken(48);
    const now = new Date();
    const updated = await this.prisma.session.updateMany({
      where: { id: sessionId, refreshTokenHash: currentHash },
      data: {
        previousTokenHash: currentHash,
        refreshTokenHash: sha256Hex(refreshToken),
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      },
    });
    if (updated.count !== 1) {
      // Rotation concurrente (deux onglets / requêtes simultanées) : l'autre requête a déjà
      // renouvelé le jeton. On délivre un jeton d'accès sans nouveau cookie (délai de grâce).
      const current = await this.prisma.session.findUnique({ where: { id: sessionId } });
      if (
        current &&
        !current.revokedAt &&
        current.previousTokenHash === currentHash &&
        Date.now() - current.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS
      ) {
        return {
          accessToken: await this.signAccess(user.id, sessionId, deviceId),
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: null,
          user: this.toMe(user),
        };
      }
      throw new AppError('UNAUTHENTICATED');
    }
    return {
      accessToken: await this.signAccess(user.id, sessionId, deviceId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      user: this.toMe(user),
    };
  }

  async logout(actor: Actor): Promise<void> {
    if (!actor.sessionId) return;
    await this.prisma.tx(async (tx) => {
      await tx.session.update({
        where: { id: actor.sessionId },
        data: { revokedAt: new Date(), revokedReason: 'Déconnexion' },
      });
      await this.audit.record(tx, {
        eventType: 'LOGOUT',
        actor,
        entityType: 'user',
        entityId: actor.userId,
        entityRef: actor.userCode,
        summary: `Déconnexion de ${actor.userCode}`,
        notify: false,
      });
    });
    this.invalidateCache(actor.sessionId);
  }

  // -------------------------------------------------------------------------
  // PIN : changement rapide d'utilisateur, verrouillage d'écran, confirmations
  // -------------------------------------------------------------------------

  /** Vérifie le PIN d'un utilisateur (avec comptage des échecs et verrouillage). */
  async checkPin(
    userCode: string,
    pin: string,
    context: { device: { id: string; name: string } | null; ip: string | null },
  ): Promise<NonNullable<UserWithRole>> {
    const settings = await this.settings.all();
    const user = await this.findUserWithRole({ code: userCode.trim().toUpperCase() });
    if (!user || !user.isActive) {
      await this.passwords.verify(null, pin);
      throw new AppError('INVALID_PIN');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError('ACCOUNT_LOCKED', { lockedUntil: user.lockedUntil.toISOString() });
    }
    if (!user.pinHash) throw new AppError('PIN_NOT_SET');
    if (!(await this.passwords.verify(user.pinHash, pin))) {
      await this.registerFailure(
        user,
        'pin',
        context.device,
        context.ip,
        settings['security.max_failed_attempts'],
        settings['security.lock_duration_minutes'],
      );
      throw new AppError('INVALID_PIN');
    }
    if (user.pinFailedAttempts > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0 } });
    }
    return user;
  }

  async switchUser(
    actor: Actor,
    input: SwitchUserInput,
    device: DeviceInfo,
    userAgent: string | null,
  ): Promise<AuthResult> {
    const target = await this.checkPin(input.userCode, input.pin, {
      device: { id: device.id, name: device.name },
      ip: actor.ip,
    });
    if (target.mustChangePassword) throw new AppError('PASSWORD_CHANGE_REQUIRED');
    const result = await this.prisma.tx(async (tx) => {
      if (actor.sessionId) {
        await tx.session.update({
          where: { id: actor.sessionId },
          data: {
            revokedAt: new Date(),
            revokedReason: `Changement d’utilisateur vers ${target.code}`,
          },
        });
      }
      const created = await this.createSession(tx, target, device.id, actor.ip, userAgent);
      await this.audit.record(tx, {
        eventType: 'USER_SWITCHED',
        user: { id: target.id, code: target.code, name: target.fullName },
        device: { id: device.id, name: device.name },
        ip: actor.ip,
        entityType: 'user',
        entityId: target.id,
        entityRef: target.code,
        summary: `Changement d’utilisateur sur « ${device.name} » : ${actor.userCode} → ${target.code}`,
        metadata: { previousUserId: actor.userId, previousUserCode: actor.userCode },
        notify: false,
      });
      return created.auth;
    });
    if (actor.sessionId) this.invalidateCache(actor.sessionId);
    return result;
  }

  async lock(actor: Actor): Promise<void> {
    if (!actor.sessionId) return;
    await this.prisma.session.update({
      where: { id: actor.sessionId },
      data: { lockedAt: new Date() },
    });
    this.invalidateCache(actor.sessionId);
  }

  /**
   * Déverrouille l'écran avec le PIN (via le cookie de renouvellement). Si un autre utilisateur
   * saisit son code + PIN sur un poste partagé, la session verrouillée est fermée et une
   * nouvelle session est ouverte pour lui (changement rapide d'utilisateur).
   */
  async unlock(
    refreshToken: string | undefined,
    pin: string,
    device: DeviceInfo,
    ip: string | null,
    userCode?: string,
    userAgent: string | null = null,
  ): Promise<AuthResult> {
    const { session } = await this.findSessionForRefresh(refreshToken, device);
    const owner = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!owner) throw new AppError('UNAUTHENTICATED');
    if (userCode && userCode.trim().toUpperCase() !== owner.code) {
      const target = await this.checkPin(userCode, pin, {
        device: { id: device.id, name: device.name },
        ip,
      });
      if (target.mustChangePassword) throw new AppError('PASSWORD_CHANGE_REQUIRED');
      const result = await this.prisma.tx(async (tx) => {
        await tx.session.update({
          where: { id: session.id },
          data: {
            revokedAt: new Date(),
            revokedReason: `Changement d’utilisateur vers ${target.code}`,
          },
        });
        const created = await this.createSession(tx, target, device.id, ip, userAgent);
        await this.audit.record(tx, {
          eventType: 'USER_SWITCHED',
          user: { id: target.id, code: target.code, name: target.fullName },
          device: { id: device.id, name: device.name },
          ip,
          entityType: 'user',
          entityId: target.id,
          entityRef: target.code,
          summary: `Changement d’utilisateur sur « ${device.name} » (écran verrouillé) : ${owner.code} → ${target.code}`,
          metadata: { previousUserId: owner.id, previousUserCode: owner.code },
          notify: false,
        });
        return created.auth;
      });
      this.invalidateCache(session.id);
      return result;
    }
    const user = await this.checkPin(owner.code, pin, {
      device: { id: device.id, name: device.name },
      ip,
    });
    await this.prisma.tx(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { lockedAt: null, lastSeenAt: new Date() },
      });
      await this.audit.record(tx, {
        eventType: 'SCREEN_UNLOCKED',
        user: { id: user.id, code: user.code, name: user.fullName },
        device: { id: device.id, name: device.name },
        ip,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `Déverrouillage de l’écran par ${user.code}`,
        notify: false,
      });
    });
    this.invalidateCache(session.id);
    return this.rotate(session.id, session.refreshTokenHash, user, device.id);
  }

  /** Confirmation d'une opération par le PIN de l'utilisateur connecté. */
  async confirmOwnPin(actor: Actor, pin: string): Promise<void> {
    await this.checkPin(actor.userCode, pin, {
      device: actor.deviceId ? { id: actor.deviceId, name: actor.deviceName ?? '' } : null,
      ip: actor.ip,
    });
  }

  // -------------------------------------------------------------------------
  // Mot de passe, PIN, double authentification
  // -------------------------------------------------------------------------

  async changePassword(actor: Actor, input: ChangePasswordInput): Promise<MeDto> {
    const user = await this.findUserWithRole({ id: actor.userId });
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', undefined, {
        status: 400,
        message: 'Mot de passe actuel incorrect.',
      });
    }
    const minLength = await this.settings.get('security.password_min_length');
    const policyError = checkPasswordPolicy(input.newPassword, minLength);
    if (policyError)
      throw new AppError(
        'PASSWORD_POLICY',
        { fieldErrors: { newPassword: policyError } },
        { status: 400 },
      );
    if (await this.passwords.verify(user.passwordHash, input.newPassword)) {
      throw new AppError(
        'PASSWORD_POLICY',
        {
          fieldErrors: { newPassword: 'Le nouveau mot de passe doit être différent de l’ancien.' },
        },
        { status: 400 },
      );
    }
    const hash = await this.passwords.hash(input.newPassword);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, mustChangePassword: false, version: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: actor.sessionId ?? '' } },
        data: { revokedAt: new Date(), revokedReason: 'Mot de passe modifié' },
      });
      await this.audit.record(tx, {
        eventType: 'PASSWORD_CHANGED',
        actor,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `${user.code} a modifié son mot de passe`,
        notify: false,
      });
    });
    this.invalidateCache();
    const refreshed = await this.findUserWithRole({ id: user.id });
    return this.toMe(refreshed!);
  }

  async changePin(actor: Actor, currentPassword: string, newPin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', undefined, {
        status: 400,
        message: 'Mot de passe actuel incorrect.',
      });
    }
    const pinHash = await this.passwords.hash(newPin);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { pinHash, pinFailedAttempts: 0 } });
      await this.audit.record(tx, {
        eventType: 'PIN_CHANGED',
        actor,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `${user.code} a modifié son PIN`,
        notify: false,
      });
    });
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.findUserWithRole({ id: userId });
    if (!user) throw new AppError('UNAUTHENTICATED');
    return this.toMe(user);
  }

  async totpSetup(actor: Actor): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: actor.userId },
      data: { totpSecret: encryptSecret(secret), totpEnabled: false },
    });
    const issuer = encodeURIComponent('PharmaStock');
    const label = encodeURIComponent(`PharmaStock:${actor.userCode}`);
    return {
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`,
    };
  }

  async totpEnable(actor: Actor, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user?.totpSecret || !verifyTotp(decryptSecret(user.totpSecret), code))
      throw new AppError('TOTP_INVALID', undefined, { status: 400 });
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
      await this.audit.record(tx, {
        eventType: 'USER_UPDATED',
        actor,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `${user.code} a activé la double authentification`,
        notify: false,
      });
    });
  }

  async totpDisable(actor: Actor, currentPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', undefined, {
        status: 400,
        message: 'Mot de passe actuel incorrect.',
      });
    }
    await this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null },
      });
      await this.audit.record(tx, {
        eventType: 'USER_UPDATED',
        actor,
        entityType: 'user',
        entityId: user.id,
        entityRef: user.code,
        summary: `${user.code} a désactivé la double authentification`,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Sessions actives (administration)
  // -------------------------------------------------------------------------

  listActiveSessions() {
    return this.prisma.session.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        absoluteExpiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        lockedAt: true,
        user: { select: { id: true, code: true, fullName: true } },
        device: { select: { id: true, name: true } },
      },
    });
  }

  async revokeSession(sessionId: string, actor: Actor): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (!session) throw new AppError('NOT_FOUND');
      if (session.revokedAt) return;
      await tx.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: `Déconnexion forcée par ${actor.userCode}` },
      });
      await this.audit.record(tx, {
        eventType: 'SESSION_REVOKED',
        actor,
        entityType: 'user',
        entityId: session.userId,
        entityRef: session.user.code,
        summary: `Déconnexion forcée de ${session.user.code} par ${actor.userCode}`,
      });
    });
    this.invalidateCache(sessionId);
  }
}
