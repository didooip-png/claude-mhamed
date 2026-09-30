import { CLIENT_TYPES, EMAIL_DOC_PREF_KEYS, EMAIL_DOCUMENT_KINDS } from '@pharmastock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField, MoneyInput, PercentInput } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Switch } from '@/components/ui/misc';
import { api, ApiError, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { Client } from '@/lib/types';

const EMPTY = {
  type: 'INDIVIDUAL',
  name: '',
  nationalIdOrTaxId: '',
  phone: '',
  phone2: '',
  email: '',
  address: '',
  creditLimit: 0 as number | null,
  defaultDiscountBp: 0,
  paymentTermsDays: 0,
  isActive: true,
  notes: '',
  emailConsent: false,
  emailDocPrefs: Object.fromEntries(EMAIL_DOC_PREF_KEYS.map((k) => [k, true])) as Record<
    string,
    boolean
  >,
  emailCc: '',
};

export function ClientFormDialog({
  client,
  open,
  onClose,
  onSaved,
}: {
  client: Client | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (c: Client) => void;
}) {
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      client
        ? {
            type: client.type,
            name: client.name,
            nationalIdOrTaxId: client.nationalIdOrTaxId ?? '',
            phone: client.phone ?? '',
            phone2: client.phone2 ?? '',
            email: client.email ?? '',
            address: client.address ?? '',
            creditLimit: client.creditLimit,
            defaultDiscountBp: client.defaultDiscountBp,
            paymentTermsDays: client.paymentTermsDays,
            isActive: client.isActive,
            notes: client.notes ?? '',
            emailConsent: client.emailConsent,
            emailDocPrefs: { ...EMPTY.emailDocPrefs, ...client.emailDocPrefs },
            emailCc: client.emailCc.join(', '),
          }
        : EMPTY,
    );
  }, [open, client]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        creditLimit: f.creditLimit ?? 0,
        emailCc: f.emailCc
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        version: client?.version,
      };
      return client
        ? api.put<Client>(`/clients/${client.id}`, body)
        : api.post<Client>('/clients', body);
    },
    onSuccess: (c) => {
      toast.success(client ? 'Client enregistré' : `Client ${c.code} créé`);
      void qc.invalidateQueries({ queryKey: ['clients'] });
      onSaved?.(c);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));
  const canCredit = can('clients.edit_credit');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {client ? `Client ${client.code} — ${client.name}` : 'Nouveau client'}
          </DialogTitle>
          <DialogDescription>
            Le plafond de crédit et la remise habituelle ne sont modifiables que par un
            administrateur.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Type" required>
            <NativeSelect value={f.type} onChange={set('type')}>
              {Object.entries(CLIENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label="Nom / raison sociale"
            required
            error={errors.name}
            className="lg:col-span-2"
          >
            <Input autoFocus value={f.name} onChange={set('name')} />
          </FormField>
          <FormField
            label={f.type === 'INDIVIDUAL' ? 'CIN' : 'Matricule fiscal'}
            error={errors.nationalIdOrTaxId}
          >
            <Input value={f.nationalIdOrTaxId} onChange={set('nationalIdOrTaxId')} />
          </FormField>
          <FormField label="Téléphone" error={errors.phone}>
            <Input value={f.phone} onChange={set('phone')} />
          </FormField>
          <FormField label="Téléphone 2" error={errors.phone2}>
            <Input value={f.phone2} onChange={set('phone2')} />
          </FormField>
          <FormField label="Adresse" className="lg:col-span-3">
            <Input value={f.address} onChange={set('address')} />
          </FormField>
          <FormField
            label="Plafond de crédit"
            hint="0 = pas de vente à crédit"
            error={errors.creditLimit}
          >
            <MoneyInput
              value={f.creditLimit}
              onValueChange={(v) => setF((p) => ({ ...p, creditLimit: v }))}
              disabled={!canCredit}
            />
          </FormField>
          <FormField label="Remise habituelle" error={errors.defaultDiscountBp}>
            <PercentInput
              value={f.defaultDiscountBp}
              onValueChange={(v) => setF((p) => ({ ...p, defaultDiscountBp: v }))}
              disabled={!canCredit}
            />
          </FormField>
          <FormField label="Délai de paiement (jours)">
            <Input
              type="number"
              min={0}
              value={f.paymentTermsDays}
              onChange={(e) =>
                setF((p) => ({ ...p, paymentTermsDays: Number(e.target.value) || 0 }))
              }
            />
          </FormField>
          <fieldset className="grid gap-3 rounded-lg border p-3 sm:col-span-2 lg:col-span-3 lg:grid-cols-3">
            <legend className="px-1 text-sm font-medium">E-mails</legend>
            <FormField label="E-mail" error={errors.email}>
              <Input type="email" value={f.email} onChange={set('email')} />
            </FormField>
            <FormField
              label="Adresses en copie"
              hint="Séparées par des virgules"
              error={errors.emailCc}
            >
              <Input value={f.emailCc} onChange={set('emailCc')} placeholder="compta@…" />
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch
                checked={f.emailConsent}
                disabled={!f.email}
                onCheckedChange={(v) => setF((p) => ({ ...p, emailConsent: v }))}
              />
              Accepte de recevoir ses documents par e-mail
            </label>
            {f.emailConsent && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 lg:col-span-3">
                {EMAIL_DOC_PREF_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={f.emailDocPrefs[k] !== false}
                      onCheckedChange={(v) =>
                        setF((p) => ({ ...p, emailDocPrefs: { ...p.emailDocPrefs, [k]: !!v } }))
                      }
                    />
                    {EMAIL_DOCUMENT_KINDS[k]}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <FormField label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={f.notes} onChange={set('notes')} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.isActive}
              onCheckedChange={(v) => setF((p) => ({ ...p, isActive: v }))}
            />{' '}
            Actif
          </label>
          <DialogFooter className="sm:col-span-2 lg:col-span-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={save.isPending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
