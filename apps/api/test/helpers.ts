import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export interface TestDevice {
  id: string;
  token: string;
}

export interface Session {
  token: string;
  cookie: string;
  device: TestDevice;
  userId: string;
}

let counter = 0;
export function uniq(prefix = 'T'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).toUpperCase().slice(-4)}${counter}`;
}

export class TestContext {
  app!: INestApplication;
  prisma!: PrismaService;
  device!: TestDevice;

  async start(): Promise<void> {
    this.app = await createApp({ logger: false });
    await this.app.init();
    this.prisma = this.app.get(PrismaService);
    this.device = await this.registerDevice('Poste de test', true);
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  async registerDevice(name: string, approve: boolean): Promise<TestDevice> {
    const res = await this.http.post('/api/v1/devices/register').send({ name }).expect(201);
    if (approve)
      await this.prisma.device.update({ where: { id: res.body.id }, data: { status: 'APPROVED' } });
    return { id: res.body.id as string, token: res.body.token as string };
  }

  /** Crée un utilisateur directement en base (mot de passe déjà changé). */
  async createUser(options: {
    role: 'ADMIN' | 'PREPARER';
    code?: string;
    password?: string;
    pin?: string;
    mustChangePassword?: boolean;
  }) {
    const passwords = this.app.get(PasswordService);
    const code = options.code ?? uniq(options.role === 'ADMIN' ? 'A' : 'P');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { systemKey: options.role } });
    return this.prisma.user.create({
      data: {
        code,
        username: code.toLowerCase(),
        fullName: `Utilisateur ${code}`,
        roleId: role.id,
        passwordHash: await passwords.hash(options.password ?? 'Motdepasse1'),
        pinHash: await passwords.hash(options.pin ?? '1234'),
        mustChangePassword: options.mustChangePassword ?? false,
      },
    });
  }

  headers(device: TestDevice = this.device): Record<string, string> {
    return { 'X-Device-Id': device.id, 'X-Device-Token': device.token };
  }

  async login(
    username: string,
    password = 'Motdepasse1',
    device: TestDevice = this.device,
  ): Promise<Session> {
    const res = await this.http
      .post('/api/v1/auth/login')
      .set(this.headers(device))
      .send({ username, password });
    if (res.status !== 200)
      throw new Error(`Connexion échouée (${res.status}) : ${JSON.stringify(res.body)}`);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    return {
      token: res.body.accessToken as string,
      cookie: setCookie.map((c) => c.split(';')[0]).join('; '),
      device,
      userId: res.body.user.id as string,
    };
  }

  /** Crée un utilisateur et ouvre une session. */
  async as(role: 'ADMIN' | 'PREPARER', device?: TestDevice): Promise<Session & { code: string }> {
    const user = await this.createUser({ role });
    const session = await this.login(user.username, 'Motdepasse1', device);
    return { ...session, code: user.code };
  }

  auth(session: Session): Record<string, string> {
    return { ...this.headers(session.device), Authorization: `Bearer ${session.token}` };
  }

  get(path: string, session: Session) {
    return this.http.get(`/api/v1${path}`).set(this.auth(session));
  }

  post(path: string, session: Session, body: unknown = {}) {
    return this.http
      .post(`/api/v1${path}`)
      .set(this.auth(session))
      .send(body as object);
  }

  put(path: string, session: Session, body: unknown = {}) {
    return this.http
      .put(`/api/v1${path}`)
      .set(this.auth(session))
      .send(body as object);
  }

  delete(path: string, session: Session) {
    return this.http.delete(`/api/v1${path}`).set(this.auth(session));
  }
}
