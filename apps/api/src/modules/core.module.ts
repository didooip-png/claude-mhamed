import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadConfig } from '../config.js';
import { AuditService } from './audit/audit.service.js';
import { AuthService } from './auth/auth.service.js';
import { OverrideService } from './auth/override.service.js';
import { PasswordService } from './auth/password.service.js';
import { DevicesService } from './devices/devices.service.js';
import { SitesService } from './devices/sites.service.js';
import { SequencesService } from './sequences/sequences.service.js';
import { SettingsService } from './settings/settings.service.js';
import { SetupService } from './setup/setup.service.js';

const services = [
  AuditService,
  AuthService,
  OverrideService,
  PasswordService,
  DevicesService,
  SitesService,
  SequencesService,
  SettingsService,
  SetupService,
];

/** Services transverses (audit, paramètres, numérotation, authentification, postes). */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: loadConfig().JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'pharmastock' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'pharmastock' },
      }),
    }),
  ],
  providers: services,
  exports: [...services, JwtModule],
})
export class CoreModule {}
