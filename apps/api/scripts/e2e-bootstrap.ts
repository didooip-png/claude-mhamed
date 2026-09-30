/**
 * Amorçage de la base des tests de bout en bout : premier administrateur (ADM01) et deux
 * préparateurs (PRE01, PRE02). Tout le reste est créé par les scénarios eux-mêmes.
 * Usage : DATABASE_URL=… node --import @swc-node/register/esm-register scripts/e2e-bootstrap.ts
 */
import 'reflect-metadata';

process.env.DISABLE_SCHEDULER = 'true';

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../src/app.module.js');
const { installBigIntJson } = await import('../src/common/json.js');
const { PasswordService } = await import('../src/modules/auth/password.service.js');
const { SetupService } = await import('../src/modules/setup/setup.service.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');

installBigIntJson();

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  await app.get(SetupService).createFirstAdmin({
    code: 'ADM01',
    username: 'admin',
    fullName: 'Amel Ben Salah',
    password: 'Admin2026',
    pin: '1234',
    establishmentName: 'Pharmacie E2E',
    mustChangePassword: false,
  });
  const prisma = app.get(PrismaService);
  const passwords = app.get(PasswordService);
  await prisma.user.update({
    where: { code: 'ADM01' },
    data: { email: 'admin@example.com', notificationEmail: 'admin@example.com' },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { systemKey: 'PREPARER' } });
  for (const u of [
    { code: 'PRE01', username: 'pre01', fullName: 'Karim Trabelsi', pin: '1111' },
    { code: 'PRE02', username: 'pre02', fullName: 'Sonia Gharbi', pin: '2222' },
  ]) {
    await prisma.user.create({
      data: {
        code: u.code,
        username: u.username,
        fullName: u.fullName,
        roleId: role.id,
        passwordHash: await passwords.hash('Prep2026'),
        pinHash: await passwords.hash(u.pin),
        mustChangePassword: false,
        email: `${u.username}@example.com`,
      },
    });
  }
  process.stdout.write('Base E2E amorcée : ADM01, PRE01, PRE02.\n');
} finally {
  await app.close();
}
