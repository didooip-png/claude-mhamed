import { Injectable } from '@nestjs/common';
import type { PaymentInput } from '@pharmastock/shared';
import { AppError } from '../../common/app-error.js';
import type { Actor } from '../../common/request-context.js';
import type { PaymentMethod } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { LedgerService } from '../accounts/ledger.service.js';
import { CashService } from '../cash/cash.service.js';
import { SequencesService } from '../sequences/sequences.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface CreatedPayment {
  id: string;
  number: string;
  method: PaymentMethod;
  amount: number;
}

/**
 * Encaissement (§6.10) : numéro REG-AAAA-NNNNNN, écriture PAYMENT au compte client,
 * mouvement de caisse pour les espèces (RG-19), affectation éventuelle à une facture.
 */
@Injectable()
export class PaymentsCoreService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly cash: CashService,
    private readonly sequences: SequencesService,
    private readonly settings: SettingsService,
  ) {}

  async create(
    tx: Tx,
    input: {
      clientId: string;
      payment: PaymentInput;
      actor: Actor;
      at: Date;
      /** Affectation immédiate à une facture (paiement en caisse). */
      allocateToSaleId?: string;
      allocateAmount?: number;
      saleId?: string;
      idempotencyKey?: string;
      notes?: string | null;
    },
  ): Promise<CreatedPayment> {
    const p = input.payment;
    let cashSessionId: string | null = null;
    if (p.method === 'CASH') {
      const session = input.actor.deviceId
        ? await this.cash.lockOpenSession(tx, input.actor.deviceId)
        : null;
      if (!session && (await this.settings.get('cash.required_for_cash_payments', tx)))
        throw new AppError('CASH_SESSION_REQUIRED');
      cashSessionId = session?.id ?? null;
    }
    const number = await this.sequences.next(tx, 'REG', input.at);
    const payment = await tx.payment.create({
      data: {
        number,
        clientId: input.clientId,
        paidAt: input.at,
        amount: BigInt(p.amount),
        method: p.method,
        chequeNumber: p.chequeNumber ?? null,
        bank: p.bank ?? null,
        dueDate: p.dueDate ? new Date(`${p.dueDate}T00:00:00Z`) : null,
        reference: p.reference ?? null,
        chequeStatus: p.method === 'CHEQUE' || p.method === 'DRAFT_BILL' ? 'IN_PORTFOLIO' : null,
        cashSessionId,
        saleId: input.saleId ?? null,
        deviceId: input.actor.deviceId,
        idempotencyKey: input.idempotencyKey ?? null,
        notes: input.notes ?? null,
        createdById: input.actor.userId,
        createdAt: input.at,
      },
    });
    await this.ledger.post(tx, {
      clientId: input.clientId,
      type: 'PAYMENT',
      credit: p.amount,
      documentType: 'PAYMENT',
      documentId: payment.id,
      documentNumber: number,
      description: `Règlement ${number}`,
      actor: input.actor,
      at: input.at,
    });
    if (cashSessionId) {
      await this.cash.addMovement(tx, {
        sessionId: cashSessionId,
        type: 'SALE_PAYMENT',
        amount: p.amount,
        documentType: 'PAYMENT',
        documentId: payment.id,
        documentRef: number,
        actor: input.actor,
        at: input.at,
      });
    }
    if (input.allocateToSaleId && (input.allocateAmount ?? p.amount) > 0) {
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          saleId: input.allocateToSaleId,
          amount: BigInt(input.allocateAmount ?? p.amount),
          createdById: input.actor.userId,
          createdAt: input.at,
        },
      });
    }
    return { id: payment.id, number, method: p.method, amount: p.amount };
  }
}
