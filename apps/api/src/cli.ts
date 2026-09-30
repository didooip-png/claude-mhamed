/**
 * Outils d'exploitation en ligne de commande :
 *   pnpm --filter @pharmastock/api cli setup             Première installation (premier administrateur)
 *   pnpm --filter @pharmastock/api cli devices           Liste des postes
 *   pnpm --filter @pharmastock/api cli approve-device ID Approuver un poste
 *   pnpm --filter @pharmastock/api cli unlock-user CODE  Déverrouiller un compte
 *   pnpm --filter @pharmastock/api cli verify-audit      Vérifier la chaîne du journal d'audit
 *   pnpm --filter @pharmastock/api cli backup            Sauvegarde immédiate de la base
 */
import 'reflect-metadata';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { installBigIntJson } from './common/json.js';
import { AuditService } from './modules/audit/audit.service.js';
import { BackupService } from './modules/backups/backup.service.js';
import { SetupService } from './modules/setup/setup.service.js';
import { PrismaService } from './prisma/prisma.service.js';

installBigIntJson();
process.env.DISABLE_SCHEDULER = 'true';

async function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const mutableOut = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) output.write(chunk, encoding as BufferEncoding);
      callback();
    },
  });
  const rl = createInterface({ input, output: mutableOut, terminal: true });
  const promise = rl.question(question);
  muted = hidden;
  const answer = await promise;
  rl.close();
  if (hidden) output.write('\n');
  return answer.trim();
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    switch (command) {
      case 'setup': {
        const setup = app.get(SetupService);
        if (await setup.hasAdmin()) {
          console.log('Un administrateur existe déjà : installation déjà effectuée.');
          break;
        }
        console.log('Première installation de PharmaStock — création du premier administrateur.\n');
        const establishmentName = await ask('Nom de l’établissement : ');
        const code = (await ask('Code administrateur (ex. ADM01) : ')).toUpperCase();
        const username = await ask('Identifiant de connexion : ');
        const fullName = await ask('Nom complet : ');
        const password = await ask('Mot de passe (8 caractères min., lettre + chiffre) : ', true);
        const confirm = await ask('Confirmation du mot de passe : ', true);
        if (password !== confirm) throw new Error('Les mots de passe ne correspondent pas.');
        const pin = await ask('PIN (4 à 6 chiffres) : ', true);
        await setup.createFirstAdmin({
          code,
          username,
          fullName,
          password,
          pin,
          establishmentName,
          mustChangePassword: false,
        });
        console.log(
          `\nAdministrateur ${code} créé. Connectez-vous depuis un navigateur : le premier poste utilisé par un administrateur est approuvé automatiquement.`,
        );
        break;
      }
      case 'devices': {
        const devices = await prisma.device.findMany({ orderBy: { createdAt: 'asc' } });
        for (const d of devices) console.log(`${d.id}  ${d.status.padEnd(9)} ${d.name}`);
        break;
      }
      case 'approve-device': {
        if (!arg) throw new Error('Usage : approve-device <id>');
        await prisma.device.update({
          where: { id: arg },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        await app.get(AuditService).recordStandalone({
          eventType: 'DEVICE_APPROVED',
          entityType: 'device',
          entityId: arg,
          summary: `Poste ${arg} approuvé en ligne de commande (exploitation)`,
        });
        console.log('Poste approuvé.');
        break;
      }
      case 'unlock-user': {
        if (!arg) throw new Error('Usage : unlock-user <CODE>');
        const user = await prisma.user.update({
          where: { code: arg.toUpperCase() },
          data: { lockedUntil: null, failedAttempts: 0, pinFailedAttempts: 0 },
        });
        await app.get(AuditService).recordStandalone({
          eventType: 'USER_UPDATED',
          entityType: 'user',
          entityId: user.id,
          entityRef: user.code,
          summary: `Compte ${user.code} déverrouillé en ligne de commande (exploitation)`,
        });
        console.log(`Compte ${user.code} déverrouillé.`);
        break;
      }
      case 'verify-audit': {
        const report = await app.get(AuditService).verifyIntegrity();
        console.log(
          report.ok
            ? `Journal intègre (${report.checked} entrées).`
            : `INTÉGRITÉ COMPROMISE à l’entrée ${report.brokenAtId} : ${report.reason}`,
        );
        if (!report.ok) process.exitCode = 2;
        break;
      }
      case 'backup': {
        const b = await app.get(BackupService).run('MANUAL');
        console.log(`Sauvegarde créée : ${b.filename} (${Number(b.sizeBytes ?? 0)} octets).`);
        break;
      }
      default:
        console.log(
          'Commandes : setup | devices | approve-device <id> | unlock-user <code> | verify-audit | backup',
        );
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
