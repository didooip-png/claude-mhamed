import { Injectable } from '@nestjs/common';
import type { RegisterDeviceInput } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import type { Actor, DeviceInfo } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SitesService } from './sites.service.js';

const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

@Injectable()
export class DevicesService {
  private readonly lastSeenWrites = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly sites: SitesService,
  ) {}

  /** Enregistre un nouveau poste. Le jeton n'est renvoyé qu'une seule fois. */
  async register(input: RegisterDeviceInput, ip: string | null, userAgent: string | null) {
    const token = randomToken(32);
    const site = await this.sites.defaultSite();
    const requireApproval = await this.settings.get('security.require_device_approval');
    const device = await this.prisma.tx(async (tx) => {
      const created = await tx.device.create({
        data: {
          name: input.name,
          kind: input.kind,
          tokenHash: sha256Hex(token),
          status: requireApproval ? 'PENDING' : 'APPROVED',
          siteId: site.id,
          lastIp: ip,
          userAgent: userAgent?.slice(0, 300) ?? null,
          lastSeenAt: new Date(),
          approvedAt: requireApproval ? null : new Date(),
        },
      });
      await this.audit.record(tx, {
        eventType: 'DEVICE_REGISTERED',
        device: { id: created.id, name: created.name },
        ip,
        entityType: 'device',
        entityId: created.id,
        entityRef: created.name,
        summary: `Nouveau poste « ${created.name} » enregistré${requireApproval ? ' (en attente d’approbation)' : ''}`,
        notify: { link: '/admin/devices' },
      });
      return created;
    });
    return { id: device.id, name: device.name, status: device.status, token };
  }

  /** Résout le poste d'une requête (en-têtes X-Device-Id + X-Device-Token). */
  async resolve(
    deviceId: string | undefined,
    token: string | undefined,
    ip: string | null,
  ): Promise<DeviceInfo> {
    if (!deviceId || !token || !/^[0-9a-f-]{36}$/i.test(deviceId))
      throw new AppError('DEVICE_UNKNOWN');
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.tokenHash !== sha256Hex(token)) throw new AppError('DEVICE_UNKNOWN');
    if (device.status === 'REVOKED') throw new AppError('DEVICE_REVOKED');
    let status = device.status;
    if (status === 'PENDING' && !(await this.settings.get('security.require_device_approval')))
      status = 'APPROVED';
    const last = this.lastSeenWrites.get(device.id) ?? 0;
    if (Date.now() - last > LAST_SEEN_WRITE_INTERVAL_MS) {
      this.lastSeenWrites.set(device.id, Date.now());
      await this.prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(), lastIp: ip },
      });
    }
    return { id: device.id, name: device.name, status, siteId: device.siteId };
  }

  async hasApprovedDevice(): Promise<boolean> {
    return (await this.prisma.device.count({ where: { status: 'APPROVED' } })) > 0;
  }

  list() {
    return this.prisma.device.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        kind: true,
        status: true,
        lastSeenAt: true,
        lastIp: true,
        userAgent: true,
        approvedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  async setStatus(
    id: string,
    status: 'APPROVED' | 'REVOKED',
    actor: Actor,
    auto = false,
  ): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const device = await tx.device.findUnique({ where: { id } });
      if (!device) throw new AppError('NOT_FOUND');
      if (device.status === status) return;
      await tx.device.update({
        where: { id },
        data:
          status === 'APPROVED'
            ? {
                status,
                approvedById: actor.userId,
                approvedAt: new Date(),
                revokedAt: null,
                revokedById: null,
              }
            : { status, revokedById: actor.userId, revokedAt: new Date() },
      });
      if (status === 'REVOKED') {
        await tx.session.updateMany({
          where: { deviceId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Poste révoqué' },
        });
      }
      await this.audit.record(tx, {
        eventType: status === 'APPROVED' ? 'DEVICE_APPROVED' : 'DEVICE_REVOKED',
        actor,
        entityType: 'device',
        entityId: id,
        entityRef: device.name,
        summary: `Poste « ${device.name} » ${status === 'APPROVED' ? 'approuvé' : 'révoqué'}${auto ? ' (premier poste de l’établissement)' : ''}`,
        before: { status: device.status },
        after: { status },
      });
    });
  }

  async rename(id: string, name: string, actor: Actor): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const device = await tx.device.findUnique({ where: { id } });
      if (!device) throw new AppError('NOT_FOUND');
      await tx.device.update({ where: { id }, data: { name } });
      await this.audit.record(tx, {
        eventType: 'DEVICE_RENAMED',
        actor,
        entityType: 'device',
        entityId: id,
        entityRef: name,
        summary: `Poste « ${device.name} » renommé en « ${name} »`,
        before: { name: device.name },
        after: { name },
        notify: false,
      });
    });
  }
}
