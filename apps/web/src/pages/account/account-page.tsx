import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { Field, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, errorText } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { ChangePasswordForm } from '../auth/auth-pages';

export function AccountPage() {
  const me = useMe();
  const { setUser } = useAuth();
  return (
    <>
      <PageHeader
        title="Mon compte"
        description="Vos identifiants personnels. Ne communiquez jamais votre mot de passe ni votre PIN."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Code utilisateur">
                <span className="font-mono font-medium">{me.code}</span>
              </Field>
              <Field label="Identifiant">{me.username}</Field>
              <Field label="Nom">{me.fullName}</Field>
              <Field label="Rôle">
                <Badge>{me.role.name}</Badge>
              </Field>
              <Field label="E-mail">{me.email ?? '—'}</Field>
              <Field label="Double authentification">
                {me.totpEnabled ? (
                  <Badge variant="green">Activée</Badge>
                ) : (
                  <Badge variant="gray">Désactivée</Badge>
                )}
              </Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>La modification ferme vos autres sessions ouvertes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm
              onDone={(u) => {
                setUser(u);
                toast.success('Mot de passe modifié');
              }}
            />
          </CardContent>
        </Card>
        <PinCard />
        {me.role.isAdmin && <TotpCard />}
      </div>
    </>
  );
}

function PinCard() {
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-pin', { currentPassword: password, newPin: pin }),
    onSuccess: () => {
      toast.success('PIN modifié');
      setPassword('');
      setPin('');
      setConfirm('');
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>PIN personnel</CardTitle>
        <CardDescription>
          Utilisé pour le changement rapide d’utilisateur, le déverrouillage et les autorisations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <FormField label="Mot de passe actuel">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nouveau PIN">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            <FormField
              label="Confirmation"
              error={confirm && confirm !== pin ? 'Ne correspond pas' : undefined}
            >
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          </div>
          <Button
            type="submit"
            loading={change.isPending}
            disabled={!password || pin.length < 4 || pin !== confirm}
            className="w-fit"
          >
            <KeyRound /> Modifier le PIN
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TotpCard() {
  const me = useMe();
  const { setUser } = useAuth();
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const refreshMe = async () => setUser(await api.get('/auth/me'));
  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>('/auth/totp/setup'),
    onSuccess: setSetup,
    onError: (e) => toast.error(errorText(e)),
  });
  const enable = useMutation({
    mutationFn: () => api.post('/auth/totp/enable', { code }),
    onSuccess: async () => {
      toast.success('Double authentification activée');
      setSetup(null);
      setCode('');
      await refreshMe();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const disable = useMutation({
    mutationFn: () => api.post('/auth/totp/disable', { currentPassword: password }),
    onSuccess: async () => {
      toast.success('Double authentification désactivée');
      setPassword('');
      await refreshMe();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Double authentification (TOTP)</CardTitle>
        <CardDescription>
          Recommandée pour les administrateurs : un code à 6 chiffres est demandé à chaque
          connexion.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {me.totpEnabled ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate();
            }}
          >
            <FormField label="Mot de passe actuel" className="flex-1">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <Button
              type="submit"
              variant="outline"
              loading={disable.isPending}
              disabled={!password}
            >
              <ShieldOff /> Désactiver
            </Button>
          </form>
        ) : setup ? (
          <>
            <p className="text-sm">
              Ajoutez ce compte dans votre application d’authentification (Google Authenticator,
              Microsoft Authenticator…) avec la clé :
            </p>
            <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-wider break-all">
              {setup.secret}
            </code>
            <a className="text-xs text-primary hover:underline" href={setup.otpauthUrl}>
              Ouvrir dans l’application (sur mobile)
            </a>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                enable.mutate();
              }}
            >
              <FormField label="Code affiché par l’application" className="flex-1">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </FormField>
              <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
                <ShieldCheck /> Activer
              </Button>
            </form>
          </>
        ) : (
          <Button className="w-fit" onClick={() => start.mutate()} loading={start.isPending}>
            <ShieldCheck /> Configurer
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
