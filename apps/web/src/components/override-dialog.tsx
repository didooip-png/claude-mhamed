import type { OverrideInput } from '@pharmastock/shared';
import { KeyRound, Loader2 } from 'lucide-react';
import * as React from 'react';
import { FormField } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { ApiError, errorText } from '@/lib/api';
import { createStore } from '@/lib/store';

interface Requirement {
  permission: string;
  label: string;
  why: string;
}

interface PendingOverride {
  requirements: Requirement[];
  error: string | null;
  submit: (input: OverrideInput) => void;
  cancel: () => void;
}

const pending = createStore<PendingOverride | null>(null);

/** Levée quand l'utilisateur ferme la demande d'autorisation (à ignorer par l'appelant). */
export class OverrideCancelled extends Error {
  constructor() {
    super('Autorisation annulée');
  }
}

export function isOverrideCancelled(err: unknown): boolean {
  return err instanceof OverrideCancelled;
}

/**
 * Exécute une opération qui peut exiger une autorisation administrateur (🔑, §5.4) :
 * sur OVERRIDE_REQUIRED, demande le code + PIN d'un administrateur et le motif,
 * puis rejoue l'opération avec ces informations (valables pour cette seule exécution).
 */
export async function withOverride<T>(call: (override?: OverrideInput) => Promise<T>): Promise<T> {
  try {
    return await call(undefined);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'OVERRIDE_REQUIRED') throw err;
    const requirements = (err.details.requirements as Requirement[] | undefined) ?? [];
    return new Promise<T>((resolve, reject) => {
      const open = (error: string | null) =>
        pending.set({
          requirements,
          error,
          cancel: () => {
            pending.set(null);
            reject(new OverrideCancelled());
          },
          submit: (input) => {
            call(input)
              .then((value) => {
                pending.set(null);
                resolve(value);
              })
              .catch((e: unknown) => {
                if (
                  e instanceof ApiError &&
                  (e.code === 'OVERRIDE_INVALID' || e.code === 'OVERRIDE_REQUIRED')
                ) {
                  const cause = e.details.cause;
                  open(
                    cause === 'SELF'
                      ? 'Vous ne pouvez pas vous autoriser vous-même : un autre administrateur doit saisir son code.'
                      : cause === 'INSUFFICIENT_RIGHTS'
                        ? 'Cet utilisateur n’a pas les droits nécessaires pour autoriser cette opération.'
                        : 'Code ou PIN incorrect.',
                  );
                } else {
                  pending.set(null);
                  reject(e);
                }
              });
          },
        });
      open(null);
    });
  }
}

/** Boîte de dialogue « Autorisation administrateur », montée une fois dans la coquille. */
export function OverrideDialogHost() {
  const current = pending.use();
  const [userCode, setUserCode] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (current) {
      setPin('');
      setBusy(false);
    } else {
      setUserCode('');
      setReason('');
    }
  }, [current]);

  if (!current) return null;
  const valid = userCode.trim() && /^\d{4,6}$/.test(pin) && reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && current.cancel()}>
      <DialogContent size="sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            setBusy(true);
            current.submit({ userCode: userCode.trim().toUpperCase(), pin, reason: reason.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-amber-600" /> Autorisation administrateur
            </DialogTitle>
            <DialogDescription>Cette opération dépasse vos droits :</DialogDescription>
          </DialogHeader>
          <ul className="flex list-disc flex-col gap-1 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {current.requirements.map((r) => (
              <li key={r.permission}>
                <span className="font-medium">{r.label}</span>
                {r.why && (
                  <span className="text-amber-800/80 dark:text-amber-300/80"> — {r.why}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Code administrateur" htmlFor="ov-code" required>
              <Input
                id="ov-code"
                autoFocus
                autoComplete="off"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                placeholder="ADM01"
              />
            </FormField>
            <FormField label="PIN" htmlFor="ov-pin" required>
              <Input
                id="ov-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          </div>
          <FormField label="Motif" htmlFor="ov-reason" required hint="Enregistré au mouchard.">
            <Textarea
              id="ov-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          {current.error && <p className="text-sm text-destructive">{current.error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => current.cancel()}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy && <Loader2 className="animate-spin" />} Autoriser
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Message d'erreur, sauf si l'utilisateur a simplement fermé la demande d'autorisation. */
export function overrideAwareError(err: unknown): string | null {
  return isOverrideCancelled(err) ? null : errorText(err);
}
