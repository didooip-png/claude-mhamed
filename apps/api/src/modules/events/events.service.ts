import { Injectable } from '@nestjs/common';
import type { Severity } from '@pharmastock/shared';
import { now } from '../../common/clock.js';
import { toPlainJson } from '../../common/json.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';

export interface DomainEventInput {
  eventType: string;
  severity: Severity;
  actorId: string | null;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
}

/**
 * File d'événements notifiables (transactionnelle) : insérés dans la même transaction que
 * l'opération métier, puis traités en arrière-plan par le moteur de notifications.
 */
@Injectable()
export class EventsService {
  async emit(tx: Tx, event: DomainEventInput): Promise<void> {
    await tx.notificationEvent.create({
      data: {
        eventType: event.eventType,
        severity: event.severity,
        actorId: event.actorId,
        title: event.title,
        body: event.body ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        link: event.link ?? null,
        data: (toPlainJson(event.data ?? {}) ?? {}) as Prisma.InputJsonValue,
        createdAt: now(),
      },
    });
  }
}
