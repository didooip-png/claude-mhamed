import type { Permission } from '@pharmastock/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { api, ApiError, onAuthEvent, refreshOnce, setAccessToken, setRefreshHandler } from './api';
import { clearDevice, getDevice, saveDevice } from './device';

export interface Me {
  id: string;
  code: string;
  username: string;
  fullName: string;
  email: string | null;
  role: { id: string; name: string; isAdmin: boolean };
  permissions: Permission[];
  mustChangePassword: boolean;
  totpEnabled: boolean;
}

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: Me;
}

export type AuthState =
  | { status: 'booting' }
  | { status: 'needsDevice' }
  | { status: 'anonymous'; devicePending: boolean; deviceName: string }
  | { status: 'locked'; user: Me | null; deviceName: string }
  | { status: 'authenticated'; user: Me; deviceName: string; devicePending: false };

interface AuthContextValue {
  state: AuthState;
  registerDevice(name: string): Promise<void>;
  login(username: string, password: string, totp?: string): Promise<void>;
  logout(): Promise<void>;
  lock(): Promise<void>;
  unlock(pin: string, userCode?: string): Promise<void>;
  switchUser(userCode: string, pin: string): Promise<void>;
  setUser(user: Me): void;
  recheckDevice(): Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<AuthState>({ status: 'booting' });
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const renewTimer = React.useRef<number | null>(null);

  const deviceName = () => getDevice()?.name ?? '';

  const scheduleRenew = React.useCallback((expiresIn: number) => {
    if (renewTimer.current) window.clearTimeout(renewTimer.current);
    renewTimer.current = window.setTimeout(
      () => {
        void refresh();
      },
      Math.max(30, expiresIn - 60) * 1000,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAuth = React.useCallback(
    (res: AuthResponse) => {
      setAccessToken(res.accessToken);
      scheduleRenew(res.expiresIn);
      setState({
        status: 'authenticated',
        user: res.user,
        deviceName: deviceName(),
        devicePending: false,
      });
    },
    [scheduleRenew],
  );

  const toAnonymous = React.useCallback(async () => {
    setAccessToken(null);
    let pending = false;
    try {
      const current = await api.get<{ status: string }>('/devices/current', { noRefresh: true });
      pending = current.status === 'PENDING';
    } catch {
      /* ignoré */
    }
    setState({ status: 'anonymous', devicePending: pending, deviceName: deviceName() });
  }, []);

  const refresh = React.useCallback(async (): Promise<boolean> => {
    try {
      const res = await api.post<AuthResponse>('/auth/refresh', undefined, { noRefresh: true });
      applyAuth(res);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCREEN_LOCKED') {
        setAccessToken(null);
        const prev = stateRef.current;
        setState({
          status: 'locked',
          user: 'user' in prev ? prev.user : null,
          deviceName: deviceName(),
        });
      }
      return false;
    }
  }, [applyAuth]);

  const bootPromise = React.useRef<Promise<void> | null>(null);
  const boot = React.useCallback(async () => {
    // Un seul démarrage à la fois (StrictMode monte deux fois les effets en développement).
    bootPromise.current ??= doBoot().finally(() => {
      bootPromise.current = null;
    });
    return bootPromise.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doBoot = async () => {
    const device = getDevice();
    if (!device) {
      setState({ status: 'needsDevice' });
      return;
    }
    try {
      await api.get<{ status: string }>('/devices/current', { noRefresh: true });
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'DEVICE_UNKNOWN' || err.code === 'DEVICE_REVOKED')
      ) {
        clearDevice();
        setState({ status: 'needsDevice' });
        return;
      }
    }
    if (!(await refreshOnce()) && stateRef.current.status !== 'locked') await toAnonymous();
  };

  React.useEffect(() => {
    setRefreshHandler(refresh);
    void boot();
    return onAuthEvent((event) => {
      if (event === 'unauthenticated') void toAnonymous();
      else if (event === 'locked') {
        setAccessToken(null);
        const prev = stateRef.current;
        setState({
          status: 'locked',
          user: 'user' in prev ? prev.user : null,
          deviceName: deviceName(),
        });
      } else if (event === 'passwordChangeRequired') {
        const prev = stateRef.current;
        if (prev.status === 'authenticated')
          setState({ ...prev, user: { ...prev.user, mustChangePassword: true } });
      } else if (event === 'deviceRejected') void boot();
    });
  }, [boot, refresh, toAnonymous]);

  const value: AuthContextValue = React.useMemo(
    () => ({
      state,
      async registerDevice(name) {
        const res = await api.post<{ id: string; token: string; name: string }>(
          '/devices/register',
          { name, kind: 'WEB' },
          { noRefresh: true },
        );
        saveDevice({ id: res.id, token: res.token, name: res.name });
        await boot();
      },
      async login(username, password, totp) {
        const res = await api.post<AuthResponse>(
          '/auth/login',
          { username, password, totp: totp || undefined },
          { noRefresh: true },
        );
        queryClient.clear();
        applyAuth(res);
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } finally {
          queryClient.clear();
          await toAnonymous();
        }
      },
      async lock() {
        try {
          await api.post('/auth/lock');
        } finally {
          setAccessToken(null);
          const prev = stateRef.current;
          setState({
            status: 'locked',
            user: 'user' in prev ? prev.user : null,
            deviceName: deviceName(),
          });
        }
      },
      async unlock(pin, userCode) {
        const res = await api.post<AuthResponse>(
          '/auth/unlock',
          { pin, userCode: userCode || undefined },
          { noRefresh: true },
        );
        if (userCode) queryClient.clear();
        applyAuth(res);
      },
      async switchUser(userCode, pin) {
        const res = await api.post<AuthResponse>('/auth/switch-user', { userCode, pin });
        queryClient.clear();
        applyAuth(res);
      },
      setUser(user) {
        const prev = stateRef.current;
        if (prev.status === 'authenticated') setState({ ...prev, user });
      },
      recheckDevice: boot,
    }),
    [state, boot, applyAuth, toAnonymous, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}

/** Utilisateur connecté (à utiliser dans les écrans authentifiés). */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('Utilisateur non connecté');
  return state.user;
}

/** Contrôle d'affichage selon les permissions (la sécurité réelle est côté serveur). */
export function useCan(): (permission: Permission) => boolean {
  const me = useMe();
  return React.useCallback((permission: Permission) => me.permissions.includes(permission), [me]);
}
