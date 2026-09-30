import { checkPasswordPolicy } from '@pharmastock/shared';
import { AlertTriangle, Monitor, ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError, errorText } from '@/lib/api';
import { useAuth, type Me } from '@/lib/auth';
import { suggestDeviceName } from '@/lib/device';

function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-accent/60 to-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/icon.svg" alt="" className="size-12" />
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          PharmaStock — gestion de stock de médicaments
        </p>
      </div>
    </div>
  );
}

/** Premier lancement sur ce navigateur : enregistrement du poste (§5.5). */
export function RegisterDevicePage() {
  const { registerDevice } = useAuth();
  const [name, setName] = React.useState(suggestDeviceName());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <AuthLayout
      title="Enregistrer ce poste"
      subtitle="Donnez un nom à ce poste de travail (ex. « Comptoir 1 », « Réserve »)."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await registerDevice(name.trim());
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField
          label="Nom du poste"
          required
          htmlFor="device-name"
          hint="Chaque opération enregistrera le poste d’où elle a été faite."
        >
          <Input
            id="device-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </FormField>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={busy} disabled={name.trim().length < 2}>
          <Monitor /> Enregistrer le poste
        </Button>
      </form>
    </AuthLayout>
  );
}

export function LoginPage({
  devicePending,
  deviceName,
}: {
  devicePending: boolean;
  deviceName: string;
}) {
  const { login, recheckDevice } = useAuth();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totp, setTotp] = React.useState('');
  const [needTotp, setNeedTotp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <AuthLayout
      title="Connexion"
      subtitle={
        <>
          Poste : <strong className="font-medium text-foreground">{deviceName}</strong>
        </>
      }
    >
      {devicePending && (
        <div className="mb-4 flex gap-2 rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            Ce poste est <strong>en attente d’approbation</strong> par un administrateur.{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => void recheckDevice()}
            >
              Vérifier à nouveau
            </button>
          </div>
        </div>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(username, password, needTotp ? totp : undefined);
          } catch (err) {
            if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
              setNeedTotp(true);
            } else {
              setError(errorText(err));
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label="Identifiant" htmlFor="username">
          <Input
            id="username"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormField>
        <FormField label="Mot de passe" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        {needTotp && (
          <FormField
            label="Code de double authentification"
            htmlFor="totp"
            hint="Code à 6 chiffres de votre application d’authentification."
          >
            <Input
              id="totp"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            />
          </FormField>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy} disabled={!username || !password}>
          Se connecter
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Changement de mot de passe obligatoire (première connexion ou réinitialisation). */
export function ForcedPasswordChangePage({ user }: { user: Me }) {
  const { setUser, logout } = useAuth();
  return (
    <AuthLayout
      title="Nouveau mot de passe"
      subtitle={`${user.fullName} (${user.code}) — choisissez votre mot de passe personnel.`}
    >
      <ChangePasswordForm
        onDone={(me) => {
          setUser(me);
          toast.success('Mot de passe modifié');
        }}
      />
      <button
        type="button"
        className="mt-4 w-full cursor-pointer text-center text-xs text-muted-foreground hover:underline"
        onClick={() => void logout()}
      >
        Se déconnecter
      </button>
    </AuthLayout>
  );
}

export function ChangePasswordForm({ onDone }: { onDone: (me: Me) => void }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const policy = next ? checkPasswordPolicy(next) : null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next !== confirm) {
          setError('Les deux mots de passe ne correspondent pas.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const me = await api.post<Me>('/auth/change-password', {
            currentPassword: current,
            newPassword: next,
          });
          setCurrent('');
          setNext('');
          setConfirm('');
          onDone(me);
        } catch (err) {
          setError(
            err instanceof ApiError && err.fieldErrors.newPassword
              ? err.fieldErrors.newPassword
              : errorText(err),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormField label="Mot de passe actuel" htmlFor="cur">
        <Input
          id="cur"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </FormField>
      <FormField
        label="Nouveau mot de passe"
        htmlFor="new"
        error={policy ?? undefined}
        hint="8 caractères minimum, au moins une lettre et un chiffre."
      >
        <Input
          id="new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </FormField>
      <FormField
        label="Confirmation"
        htmlFor="confirm"
        error={confirm && confirm !== next ? 'Ne correspond pas' : undefined}
      >
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </FormField>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        loading={busy}
        disabled={!current || !next || !!policy || next !== confirm}
      >
        <ShieldCheck /> Enregistrer le mot de passe
      </Button>
    </form>
  );
}

export function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <img src="/icon.svg" alt="" className="size-10 animate-pulse" />
        Chargement…
      </div>
    </div>
  );
}
