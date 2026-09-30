import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../config.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

type Hook = () => Promise<void>;
const beforeCommitHooks = new WeakMap<object, Hook[]>();

/**
 * Enregistre une action à exécuter à la fin de la transaction, juste avant le COMMIT
 * (ex. écriture du journal d'audit, qui prend un verrou global : le prendre en dernier
 * évite les interblocages entre postes).
 */
export function beforeCommit(tx: Tx, hook: Hook): void {
  const hooks = beforeCommitHooks.get(tx);
  if (!hooks) throw new Error('Transaction non gérée : utilisez PrismaService.tx()');
  hooks.push(hook);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: loadConfig().DATABASE_URL, max: 20 });
    super({ adapter });
  }

  /**
   * Transaction ACID (READ COMMITTED + verrous explicites FOR UPDATE).
   * Toute opération touchant le stock ou l'argent passe par ici.
   */
  tx<T>(fn: (tx: Tx) => Promise<T>, options: { timeout?: number } = {}): Promise<T> {
    return this.$transaction(
      async (tx) => {
        const hooks: Hook[] = [];
        beforeCommitHooks.set(tx, hooks);
        const result = await fn(tx);
        for (let i = 0; i < hooks.length; i += 1) await hooks[i]!();
        beforeCommitHooks.delete(tx);
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: options.timeout ?? 30_000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
