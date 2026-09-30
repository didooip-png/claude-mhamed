import type { INestApplicationContext } from '@nestjs/common';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { SetupService } from '../../src/modules/setup/setup.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const DEMO_USERS = [
  {
    code: 'ADM01',
    username: 'admin',
    fullName: 'Amel Ben Salah',
    password: 'Admin2026',
    pin: '1234',
    role: 'ADMIN' as const,
  },
  {
    code: 'PRE01',
    username: 'pre01',
    fullName: 'Karim Trabelsi',
    password: 'Prep2026',
    pin: '1111',
    role: 'PREPARER' as const,
  },
  {
    code: 'PRE02',
    username: 'pre02',
    fullName: 'Sonia Gharbi',
    password: 'Prep2026',
    pin: '2222',
    role: 'PREPARER' as const,
  },
];

export async function seedDemo(app: INestApplicationContext): Promise<void> {
  const prisma = app.get(PrismaService);
  const setup = app.get(SetupService);
  if (await setup.hasAdmin()) {
    console.log('Données déjà présentes : seed ignoré (réinitialisez la base pour recommencer).');
    return;
  }
  const [admin, ...others] = DEMO_USERS;
  await setup.createFirstAdmin({
    ...admin!,
    establishmentName: 'Pharmacie Ennasr (démonstration)',
    mustChangePassword: false,
  });
  const passwords = app.get(PasswordService);
  const preparer = await prisma.role.findUniqueOrThrow({ where: { systemKey: 'PREPARER' } });
  for (const u of others) {
    await prisma.user.create({
      data: {
        code: u.code,
        username: u.username,
        fullName: u.fullName,
        roleId: preparer.id,
        passwordHash: await passwords.hash(u.password),
        pinHash: await passwords.hash(u.pin),
        mustChangePassword: false,
      },
    });
  }
  console.log(
    'Utilisateurs de démonstration créés : ADM01 (admin / Admin2026), PRE01 (pre01 / Prep2026), PRE02 (pre02 / Prep2026).',
  );
}
