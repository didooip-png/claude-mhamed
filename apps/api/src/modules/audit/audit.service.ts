import { Injectable, Logger } from '@nestjs/common';
import { AUDIT_EVENTS, type AuditEventType, type Severity } from '@pharmastock/shared';
import { sha256Hex } from '../../common/crypto.js';
import { now } from '../../common/clock.js';
import { canonicalJson, toPlainJson } from '../../common/json.js';
import type { Actor } from '../../common/request-context.js';
import { Prisma } from '../../generated/prisma/client.js';
import { beforeCommit, PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

/** Clé du verrou consultatif PostgreSQL qui sérialise l'écriture du journal (RG-20). */
const AUDIT_LOCK_KEY = 7_142_001;
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  eventType: AuditEventType;
  summary: string;
  actor?: Actor | null;
  /** Utilisateur concerné quand il n'y a pas d'acteur authentifié (ex. échec de connexion). */
  user?: { id: string | null; code: string | null; name: string | null } | null;
  device?: { id: string | null; name: string | null } | null;
  ip?: string | null;
  authorizedBy?: { id: string; code: string } | null;
  entityType?: string;
  entityId?: string;
  entityRef?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  reason?: string | null;
  severity?: Severity;
  /** Données transmises au moteur de notifications (seuils, montants…). */
  notify?: { title?: string; body?: string; link?: string; data?: Record<string, unknown> } | false;
}

interface HashableEntry {
  occurredAt: string;
  userId: string | null;
  userCode: string | null;
  userName: string | null;
  authorizedById: string | null;
  authorizedByCode: string | null;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  eventType: string;
  severity: string;
  entityType: string | null;
  entityId: string | null;
  entityRef: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  reason: string | null;
}

export function computeAuditHash(prevHash: string, entry: HashableEntry): string {
  return sha256Hex(prevHash + canonicalJson(entry));
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const plain = toPlainJson(value);
  return plain === null ? Prisma.DbNull : (plain as Prisma.InputJsonValue);
}

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  brokenAtId: number | null;
  reason: string | null;
  checkedAt: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Ajoute une entrée au journal, dans la transaction de l'opération métier.
   * L'écriture est différée juste avant le COMMIT : le verrou consultatif qui garantit la
   * continuité de la chaîne est ainsi pris en dernier (pas d'interblocage avec les verrous
   * de lignes) et les entrées sont annulées avec la transaction en cas d'échec.
   */
  async record(tx: Tx, input: AuditEntryInput): Promise<void> {
    beforeCommit(tx, () => this.write(tx, input));
  }

  private async write(tx: Tx, input: AuditEntryInput): Promise<void> {
    const def = AUDIT_EVENTS[input.eventType];
    const severity = input.severity ?? def.severity;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)`;
    const last = await tx.$queryRaw<{ hash: string }[]>`SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1`;
    const prevHash = last[0]?.hash ?? AUDIT_GENESIS_HASH;
    const occurredAt = now();

    const actor = input.actor ?? null;
    const entry: HashableEntry = {
      occurredAt: occurredAt.toISOString(),
      userId: actor?.userId ?? input.user?.id ?? null,
      userCode: actor?.userCode ?? input.user?.code ?? null,
      userName: actor?.userName ?? input.user?.name ?? null,
      authorizedById: input.authorizedBy?.id ?? null,
      authorizedByCode: input.authorizedBy?.code ?? null,
      deviceId: actor?.deviceId ?? input.device?.id ?? null,
      deviceName: actor?.deviceName ?? input.device?.name ?? null,
      ip: actor?.ip ?? input.ip ?? null,
      eventType: input.eventType,
      severity,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityRef: input.entityRef ?? null,
      summary: input.summary,
      before: toPlainJson(input.before),
      after: toPlainJson(input.after),
      metadata: toPlainJson(input.metadata),
      reason: input.reason ?? null,
    };
    const hash = computeAuditHash(prevHash, entry);

    await tx.auditLog.create({
      data: {
        occurredAt,
        userId: entry.userId,
        userCode: entry.userCode,
        userName: entry.userName,
        authorizedById: entry.authorizedById,
        authorizedByCode: entry.authorizedByCode,
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        ip: entry.ip,
        eventType: entry.eventType,
        severity,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityRef: entry.entityRef,
        summary: entry.summary,
        before: jsonOrNull(input.before),
        after: jsonOrNull(input.after),
        metadata: jsonOrNull(input.metadata),
        reason: entry.reason,
        prevHash,
        hash,
      },
    });

    if (input.notify !== false) {
      await this.events.emit(tx, {
        eventType: input.eventType,
        severity,
        actorId: entry.userId,
        title: input.notify?.title ?? def.label,
        body: input.notify?.body ?? input.summary,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        link: input.notify?.link ?? null,
        data: {
          userCode: entry.userCode,
          userName: entry.userName,
          authorizedByCode: entry.authorizedByCode,
          entityRef: entry.entityRef,
          reason: entry.reason,
          ...(input.notify?.data ?? {}),
        },
      });
    }
  }

  /** Entrée isolée, dans sa propre transaction (connexions, exports…). */
  async recordStandalone(input: AuditEntryInput): Promise<void> {
    await this.prisma.tx((tx) => this.record(tx, input));
  }

  /** Vérifie toute la chaîne de hash (RG-20). */
  async verifyIntegrity(): Promise<IntegrityReport> {
    let prevHash = AUDIT_GENESIS_HASH;
    let lastId = 0n;
    let checked = 0;
    const batch = 2000;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: batch,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const entry: HashableEntry = {
          occurredAt: row.occurredAt.toISOString(),
          userId: row.userId,
          userCode: row.userCode,
          userName: row.userName,
          authorizedById: row.authorizedById,
          authorizedByCode: row.authorizedByCode,
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          ip: row.ip,
          eventType: row.eventType,
          severity: row.severity,
          entityType: row.entityType,
          entityId: row.entityId,
          entityRef: row.entityRef,
          summary: row.summary,
          before: row.before ?? null,
          after: row.after ?? null,
          metadata: row.metadata ?? null,
          reason: row.reason,
        };
        if (row.prevHash !== prevHash) {
          return this.report(false, checked, row.id, 'Chaînage rompu : une entrée précédente a été supprimée ou insérée.');
        }
        if (computeAuditHash(prevHash, entry) !== row.hash) {
          return this.report(false, checked, row.id, 'Contenu altéré : le hash ne correspond plus au contenu de l’entrée.');
        }
        prevHash = row.hash;
        lastId = row.id;
        checked += 1;
      }
    }
    return this.report(true, checked, null, null);
  }

  private report(ok: boolean, checked: number, brokenAtId: bigint | null, reason: string | null): IntegrityReport {
    if (!ok) this.logger.error({ brokenAtId: brokenAtId?.toString(), reason }, 'Intégrité du journal compromise');
    return {
      ok,
      checked,
      brokenAtId: brokenAtId === null ? null : Number(brokenAtId),
      reason,
      checkedAt: new Date().toISOString(),
    };
  }
}
