import type { PaymentInput } from '@pharmastock/shared';
import { setSeedClock } from '../../src/common/clock.js';
import type { Actor } from '../../src/common/request-context.js';
import { CashService } from '../../src/modules/cash/cash.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { SalesService } from '../../src/modules/sales/sales.service.js';
import { SettingsService } from '../../src/modules/settings/settings.service.js';
import type { SeedContext } from './history.js';

/** Code + PIN de l'administrateur de démonstration pour les autorisations 🔑 simulées. */
const OVERRIDE = { userCode: 'ADM01', pin: '1234' };
const DOCTORS = ['Dr Ben Salah', 'Dr Trabelsi', 'Dr Gharbi', 'Dr Mansour', 'Dr Jebali', 'Dr Sfar'];
const BANKS = ['BIAT', 'STB', 'BH', 'Attijari', 'UIB', 'Amen Bank'];

type Cashier = 'pre1' | 'pre2';

interface OpenSession {
  id: string;
  actor: Actor;
}

interface DayEvent {
  minutes: number; // minutes depuis minuit
  run: () => Promise<void>;
}

/** Ventes, annulations, paniers abandonnés, sessions de caisse d'une journée (historique de démonstration). */
export class SalesHistory {
  private readonly sales: SalesService;
  private readonly cash: CashService;
  private readonly documents: DocumentsService;
  private readonly settings: SettingsService;
  private admin2: Actor;
  private day = 0;
  private sellable = new Map<string, number>();
  private stats = { sales: 0, cancelled: 0, modified: 0, discarded: 0, closed: 0 };

  constructor(private readonly ctx: SeedContext) {
    this.sales = ctx.app.get(SalesService);
    this.cash = ctx.app.get(CashService);
    this.documents = ctx.app.get(DocumentsService);
    this.settings = ctx.app.get(SettingsService);
    this.admin2 = ctx.actors.admin2;
  }

  get summary(): string {
    const s = this.stats;
    return `${s.sales} ventes (${s.cancelled} annulées, ${s.modified} modifiées), ${s.discarded} paniers abandonnés, ${s.closed} caisses clôturées`;
  }

  private actor(who: Cashier): Actor {
    return who === 'pre1' ? this.ctx.actors.pre1 : this.ctx.actors.pre2;
  }

  private setClock(day: string, minutes: number): void {
    setSeedClock(this.ctx.at(day, Math.floor(minutes / 60), minutes % 60));
  }

  private async loadSellable(day: string): Promise<void> {
    const rows = await this.ctx.prisma.$queryRaw<{ product_id: string; sellable: bigint }[]>`
      SELECT product_id, COALESCE(SUM(remaining_qty), 0)::bigint AS sellable FROM lots
      WHERE status = 'ACTIVE' AND remaining_qty > 0 AND expiry_date > ${day}::date GROUP BY product_id`;
    this.sellable = new Map(rows.map((r) => [r.product_id, Number(r.sellable)]));
  }

  /** Produit vendable (stock suffisant), tiré selon la popularité. */
  private pickProduct(exclude: Set<string> = new Set()) {
    const { random, products } = this.ctx;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const p = random.pick(products);
      if (exclude.has(p.id) || !random.chance(0.15 + p.seed.popularity / 12)) continue;
      const unit = p.sellByUnit && random.chance(0.3) ? ('UNIT' as const) : ('PACK' as const);
      const qty =
        unit === 'UNIT'
          ? random.int(2, Math.min(10, p.unitsPerPack))
          : random.chance(0.25)
            ? random.int(2, 3)
            : 1;
      const base = unit === 'UNIT' ? qty : qty * (p.sellByUnit ? p.unitsPerPack : 1);
      if ((this.sellable.get(p.id) ?? 0) >= base) return { p, unit, qty, base };
    }
    return null;
  }

  private clientForSale(): { id: string; index: number } {
    const { random, clientIds } = this.ctx;
    // Les clients « fidèles » (premiers de la liste) reviennent plus souvent.
    const index = random.chance(0.4) ? random.int(0, 7) : random.int(0, clientIds.length - 1);
    return { id: clientIds[index]!, index };
  }

  // ---------------------------------------------------------------------------

  async runDay(day: string, weekday: number, isToday: boolean, realNow: Date): Promise<void> {
    const { random } = this.ctx;
    this.day += 1;
    await this.loadSellable(day);
    const saturday = weekday === 5;
    const openAt = 8 * 60 + random.int(0, 10);
    const closeAt = saturday ? 14 * 60 + random.int(0, 15) : 19 * 60 + 30 + random.int(0, 25);
    const cutoff = isToday ? realNow : null;
    const isFuture = (minutes: number) =>
      cutoff !== null && this.ctx.at(day, Math.floor(minutes / 60), minutes % 60) > cutoff;
    if (isFuture(openAt + 5)) return; // journée du jour pas encore commencée

    // Ouverture des caisses (Comptoir 1 : PRE01, Comptoir 2 : PRE02).
    const sessions = new Map<Cashier, OpenSession>();
    for (const [who, float, delay] of [
      ['pre1', 100_000, 0],
      ['pre2', 80_000, 7],
    ] as const) {
      this.setClock(day, openAt + delay);
      const actor = this.actor(who);
      const s = await this.cash.open(actor, float + random.int(0, 4) * 10_000, null);
      sessions.set(who, { id: s.id, actor });
    }

    const events: DayEvent[] = [];
    const count = saturday ? random.int(5, 10) : random.int(7, 15);
    for (let i = 0; i < count; i += 1) {
      const minutes =
        openAt + 20 + Math.floor(((closeAt - openAt - 40) * (i + random.next() * 0.8)) / count);
      const who: Cashier = random.chance(0.62) ? 'pre1' : 'pre2';
      events.push({ minutes, run: () => this.oneSale(day, minutes, who, events, closeAt) });
    }
    // Sorties de caisse (dépenses) faites par l'administrateur.
    if (random.chance(0.12)) {
      const minutes = openAt + random.int(120, 300);
      events.push({
        minutes,
        run: async () => {
          this.setClock(day, minutes);
          await this.cash.manualMovement(this.ctx.actors.admin, {
            type: 'EXPENSE',
            amount: random.int(4, 25) * 1000,
            reason: random.pick([
              'Achat de fournitures de bureau',
              'Café et eau pour l’équipe',
              'Frais de livraison',
              'Petit matériel',
            ]),
          });
        },
      });
    }
    if (random.chance(0.05)) {
      const minutes = openAt + random.int(60, 400);
      events.push({
        minutes,
        run: async () => {
          this.setClock(day, minutes);
          await this.cash.manualMovement(this.ctx.actors.admin, {
            type: 'DRAWER_OPEN',
            amount: 0,
            reason: 'Changement de monnaie',
          });
        },
      });
    }
    // Les événements ajoutés en cours de route (annulations…) sont insérés à leur heure.
    while (events.length > 0) {
      events.sort((a, b) => a.minutes - b.minutes);
      const next = events.shift()!;
      if (isFuture(next.minutes)) continue;
      await next.run();
    }

    if (isToday) return; // les caisses du jour restent ouvertes
    // Clôture avec comptage à l'aveugle : écart nul, léger, ou important (alerte administrateur).
    for (const [who, session] of sessions) {
      this.setClock(day, closeAt + (who === 'pre1' ? 5 : 15));
      const summary = await this.cash.summary(session.id);
      const r = random.next();
      const error =
        r < 0.6
          ? 0
          : r < 0.93
            ? random.pick([-1, 1]) * random.int(1, 200) * 10
            : random.pick([-1, 1]) * random.int(6, 25) * 1000;
      await this.cash.close(
        session.id,
        {
          denominations: await this.denominations(Math.max(0, summary.expected + error)),
          notes: null,
        },
        session.actor,
      );
      this.stats.closed += 1;
    }
  }

  private async denominations(amount: number): Promise<{ value: number; count: number }[]> {
    const list = [...(await this.settings.get('cash.denominations'))].sort(
      (a, b) => b.value - a.value,
    );
    let rest = Math.round(amount / 10) * 10;
    const out: { value: number; count: number }[] = [];
    for (const d of list) {
      const count = Math.floor(rest / d.value);
      if (count > 0) out.push({ value: d.value, count });
      rest -= count * d.value;
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  private async oneSale(
    day: string,
    minutes: number,
    who: Cashier,
    events: DayEvent[],
    closeAt: number,
  ): Promise<void> {
    const { random } = this.ctx;
    const actor = this.actor(who);
    const prepFactor = who === 'pre2' ? 2 : 1; // PRE02 : davantage de retraits de lignes / paniers abandonnés
    this.setClock(day, minutes);

    const client = this.clientForSale();
    const clientData = this.ctx.clientsData[client.index]!;
    let sale = await this.sales.create(actor, client.id);
    const chosen: { p: SeedContext['products'][number]; base: number }[] = [];
    const used = new Set<string>();
    const lineCount = random.chance(0.45) ? 1 : random.chance(0.6) ? 2 : random.int(3, 5);
    for (let i = 0; i < lineCount; i += 1) {
      const pick = this.pickProduct(used);
      if (!pick) break;
      used.add(pick.p.id);
      sale = await this.sales.addLine(
        sale.id,
        { productId: pick.p.id, qty: pick.qty, unit: pick.unit },
        actor,
      );
      chosen.push({ p: pick.p, base: pick.base });
    }
    if (chosen.length === 0) {
      await this.sales.discard(sale.id, actor);
      return;
    }

    // Panier abandonné (tracé) ou vente en attente puis reprise.
    if (random.chance(0.035 * prepFactor)) {
      await this.sales.discard(sale.id, actor);
      this.stats.discarded += 1;
      return;
    }
    if (random.chance(0.03)) {
      await this.sales.hold(sale.id, actor);
      this.setClock(day, minutes + random.int(1, 3));
      sale = await this.sales.resume(sale.id, actor);
    }
    // Ligne ajoutée puis retirée.
    if (random.chance(0.07 * prepFactor)) {
      const extra = this.pickProduct(used);
      if (extra) {
        const withExtra = await this.sales.addLine(
          sale.id,
          { productId: extra.p.id, qty: 1, unit: 'PACK' },
          actor,
        );
        const line = withExtra.lines.find((l) => l.product.id === extra.p.id)!;
        sale = await this.sales.removeLine(sale.id, line.id, actor);
      }
    }
    // Remise hors plafond autorisée par l'administrateur.
    if (random.chance(0.025) && sale.lines.length > 0) {
      sale = await this.sales.updateLine(
        sale.id,
        sale.lines[0]!.id,
        {
          discountBp: random.pick([1000, 1500, 2000]),
          override: {
            ...OVERRIDE,
            reason: random.pick([
              'Client fidèle',
              'Geste commercial',
              'Produit proche de la péremption',
            ]),
          },
        },
        actor,
      );
    } else if (random.chance(0.06) && sale.lines.length > 0) {
      sale = await this.sales.updateLine(
        sale.id,
        sale.lines[0]!.id,
        { discountBp: random.pick([200, 300, 500]) },
        actor,
      );
    }
    // Ordonnance.
    if (sale.prescription.required) {
      sale = await this.sales.setPrescription(
        sale.id,
        {
          prescriberName: random.pick(DOCTORS),
          prescriptionRef: `ORD-${random.int(1000, 99999)}`,
          prescriptionDate: day,
        },
        actor,
      );
    }

    const total = sale.totals.totalTtc;
    const payments = await this.paymentsFor(total, client.id, clientData);
    this.setClock(day, minutes + random.int(1, 4));
    const result = await this.sales.validate(
      sale.id,
      { payments, useCredit: 0, document: 'NONE' },
      `seed-${day}-${minutes}-${who}-${this.stats.sales}`,
      actor,
    );
    this.stats.sales += 1;
    const validated = result.sale;
    for (const c of chosen) this.sellable.set(c.p.id, (this.sellable.get(c.p.id) ?? 0) - c.base);
    // Ticket imprimé à la vente ; quelques réimpressions (DUPLICATA).
    await this.ctx.prisma.sale.update({
      where: { id: validated.id },
      data: { printCount: random.chance(0.75) ? 1 : 0 },
    });
    if (random.chance(0.02)) {
      const at = Math.min(minutes + random.int(20, 90), closeAt - 10);
      events.push({
        minutes: at,
        run: async () => {
          this.setClock(day, at);
          await this.documents.printSale(validated.id, 'A4', actor);
          await this.documents.printSale(validated.id, 'A4', actor);
        },
      });
    }

    // Annulation par l'administrateur (motif obligatoire) ou modification.
    const followUp = random.next();
    if (followUp < 0.035 && validated.number) {
      const at = Math.min(minutes + random.int(5, 90), closeAt - 10);
      events.push({
        minutes: at,
        run: async () => {
          this.setClock(day, at);
          const admin = this.adminFor(who);
          const paidCash = validated.payments.some((p) => p.method === 'CASH');
          const walkIn = validated.client?.isWalkIn ?? false;
          const reasonCode = random.pick([
            'CUSTOMER_REQUEST',
            'ENTRY_ERROR',
            'WRONG_PRODUCT',
            'PAYMENT_ISSUE',
            'DUPLICATE',
          ] as const);
          await this.sales.cancel(
            validated.id,
            {
              reasonCode,
              reason: random.pick([
                'Le client a changé d’avis',
                'Erreur de saisie de la quantité',
                'Produit non conforme à l’ordonnance',
                'Paiement refusé par la banque',
                'Vente saisie deux fois',
              ]),
              refundMode: paidCash || walkIn ? 'REFUND' : 'CREDIT',
            },
            admin,
          );
          this.stats.cancelled += 1;
        },
      });
    } else if (followUp < 0.05 && validated.lines.some((l) => l.qty >= 2)) {
      const at = Math.min(minutes + random.int(5, 60), closeAt - 10);
      events.push({
        minutes: at,
        run: async () => {
          this.setClock(day, at);
          const idx = validated.lines.findIndex((l) => l.qty >= 2);
          await this.sales.modify(
            validated.id,
            {
              reasonCode: 'ENTRY_ERROR',
              reason: 'Quantité saisie en trop',
              lines: validated.lines.map((l, i) => ({
                productId: l.product.id,
                qty: i === idx ? l.qty - 1 : l.qty,
                unit: l.unit,
                discountBp: l.discountBp,
                ...(l.authorized.price ? { unitPriceTtc: Number(l.unitPriceTtc) } : {}),
              })),
              payments: [],
              excessMode: validated.client?.isWalkIn ? 'REFUND' : 'CREDIT',
            },
            this.adminFor(who),
          );
          this.stats.modified += 1;
        },
      });
    }
  }

  private adminFor(who: Cashier): Actor {
    return who === 'pre1' ? this.ctx.actors.admin : this.admin2;
  }

  /** Modes de paiement : espèces, carte, chèque, virement, ou vente à crédit dans la limite du plafond. */
  private async paymentsFor(
    total: number,
    clientId: string,
    clientData: SeedContext['clientsData'][number],
  ): Promise<PaymentInput[]> {
    const { random } = this.ctx;
    const pro = clientData.type !== 'INDIVIDUAL';
    if (clientData.creditLimit > 0 && random.chance(pro ? 0.7 : 0.35)) {
      const balance = Number(
        (await this.ctx.prisma.client.findUniqueOrThrow({ where: { id: clientId } })).balance,
      );
      const upfront = random.chance(0.4) ? Math.round((total * random.int(1, 5)) / 100) * 10 : 0;
      if (balance + total - upfront <= clientData.creditLimit) {
        return upfront > 0
          ? [{ method: 'CASH', amount: upfront, tendered: Math.ceil(upfront / 1000) * 1000 }]
          : [];
      }
    }
    const r = random.next();
    if (pro && r < 0.35)
      return [
        { method: 'TRANSFER', amount: total, reference: `VIR-${random.int(100000, 999999)}` },
      ];
    if (r < 0.55)
      return [{ method: 'CASH', amount: total, tendered: Math.ceil(total / 5000) * 5000 }];
    if (r < 0.62) {
      const first = Math.round((total * random.int(3, 7)) / 100) * 10;
      return [
        { method: 'CASH', amount: first, tendered: Math.ceil(first / 1000) * 1000 },
        { method: 'CARD', amount: total - first },
      ];
    }
    if (r < 0.7) return [{ method: 'CARD', amount: total }];
    if (r < 0.74 && total >= 15_000) {
      return [
        {
          method: 'CHEQUE',
          amount: total,
          chequeNumber: String(random.int(1_000_000, 9_999_999)),
          bank: random.pick(BANKS),
        },
      ];
    }
    return [
      {
        method: 'CASH',
        amount: total,
        tendered: Math.ceil(total / 1000) * 1000 + (random.chance(0.5) ? 0 : 4000),
      },
    ];
  }
}
