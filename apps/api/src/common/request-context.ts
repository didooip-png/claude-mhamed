import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '@pharmastock/shared';

export interface AuthUser {
  id: string;
  code: string;
  fullName: string;
  roleId: string;
  roleName: string;
  isAdminRole: boolean;
  permissions: ReadonlySet<Permission>;
  sessionId: string;
  mustChangePassword: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  siteId: string;
}

export interface RequestContextData {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  user?: AuthUser;
  device?: DeviceInfo;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
};

/**
 * Acteur d'une opération : utilisateur + poste + adresse IP.
 * Transmis explicitement aux services de domaine (testables sans HTTP).
 */
export interface Actor {
  userId: string;
  userCode: string;
  userName: string;
  permissions: ReadonlySet<Permission>;
  isAdmin: boolean;
  deviceId: string | null;
  deviceName: string | null;
  siteId: string;
  ip: string | null;
  sessionId?: string;
}

export function hasPermission(actor: Pick<Actor, 'permissions'>, permission: Permission): boolean {
  return actor.permissions.has(permission);
}
