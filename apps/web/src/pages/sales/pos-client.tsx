import { CLIENT_TYPES } from '@pharmastock/shared';
import { AlertTriangle, Loader2, Search, UserPlus, UserRound, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox, Kbd } from '@/components/ui/misc';
import { api, ApiError, errorText } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ClientSearchResult, SaleClient } from './sale-types';

/** Recherche d'un client au clavier : nom, code, téléphone, CIN / matricule fiscal. */
export function ClientSearch({
  onSelect,
  inputRef,
  autoFocus,
}: {
  onSelect: (client: ClientSearchResult) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<ClientSearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const requestId = React.useRef(0);
  const fmt = useFormat();
  const listId = React.useId();

  React.useEffect(() => {
    const id = ++requestId.current;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .get<ClientSearchResult[]>('/clients/search', { query: { q: query } })
        .then((res) => {
          if (id === requestId.current) {
            setResults(res);
            setActive(0);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [query]);

  const choose = (c: ClientSearchResult) => {
    onSelect(c);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-label="Rechercher un client"
        className="pl-8"
        placeholder="Client : nom, code, téléphone, CIN…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          const input = e.currentTarget;
          window.setTimeout(() => {
            if (document.activeElement !== input) setOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const pick = results[active];
            if (pick) choose(pick);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {loading && (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && query.trim() && !loading && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-80 w-full min-w-[22rem] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
        >
          {results.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Aucun client trouvé.
            </li>
          )}
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2',
                i === active && 'bg-muted',
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.code}
                  {c.phone && ` · ${c.phone}`}
                  {c.nationalIdOrTaxId && ` · ${c.nationalIdOrTaxId}`}
                </div>
              </div>
              {c.balance !== 0 && (
                <span
                  className={cn(
                    'shrink-0 text-xs tabular',
                    c.balance > 0 ? 'text-destructive' : 'text-emerald-700',
                  )}
                >
                  {c.balance > 0
                    ? `Doit ${fmt.money(c.balance)}`
                    : `Crédit ${fmt.money(-c.balance)}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Situation du client choisi : solde, avoir disponible, plafond restant, factures échues (§6.6). */
export function ClientCard({
  client,
  walkIn,
  onClear,
  onChange,
}: {
  client: SaleClient | null;
  walkIn: boolean;
  onClear: () => void;
  onChange: () => void;
}) {
  const fmt = useFormat();
  if (!client) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        <UserRound className="size-4" />
        {walkIn ? 'Client comptoir (acheteur non identifié)' : 'Aucun client choisi'}
        {walkIn && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={onClear}
            aria-label="Retirer"
          >
            <X />
          </Button>
        )}
      </div>
    );
  }
  const a = client.account;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{client.name}</span>
          <Badge variant="gray">{client.code}</Badge>
          {client.defaultDiscountBp > 0 && (
            <Badge variant="blue">Remise {fmt.percent(client.defaultDiscountBp)}</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {CLIENT_TYPES[client.type as keyof typeof CLIENT_TYPES] ?? client.type}
          {client.phone && ` · ${client.phone}`}
          {client.email && ` · ${client.email}`}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <div>
          <dt className="text-muted-foreground">Solde</dt>
          <dd className={cn('font-medium tabular', a.balance > 0 && 'text-destructive')}>
            {fmt.money(a.balance)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Crédit disponible</dt>
          <dd
            className={cn(
              'font-medium tabular',
              a.availableCredit > 0 && 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {fmt.money(a.availableCredit)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Plafond restant</dt>
          <dd className="font-medium tabular">
            {a.creditLimit > 0 ? fmt.money(a.creditRemaining) : 'Pas de crédit'}
          </dd>
        </div>
      </dl>
      {a.overdueCount > 0 && (
        <Badge variant="red" className="gap-1">
          <AlertTriangle className="size-3" /> {a.overdueCount} facture(s) échue(s) ·{' '}
          {fmt.money(a.overdueAmount)}
        </Badge>
      )}
      <Button variant="outline" size="sm" className="ml-auto" onClick={onChange}>
        Changer <Kbd>F3</Kbd>
      </Button>
    </div>
  );
}

/** Création rapide d'un client depuis la caisse : nom + téléphone au minimum. */
export function QuickClientDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (client: { id: string }) => void;
}) {
  const [form, setForm] = React.useState({
    name: '',
    phone: '',
    type: 'INDIVIDUAL',
    nationalIdOrTaxId: '',
    email: '',
    emailConsent: false,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setForm({
        name: initialName ?? '',
        phone: '',
        type: 'INDIVIDUAL',
        nationalIdOrTaxId: '',
        email: '',
        emailConsent: false,
      });
      setErrors({});
    }
  }, [open, initialName]);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const created = await api.post<{ id: string; name: string }>('/clients/quick', {
        name: form.name,
        phone: form.phone,
        type: form.type,
        nationalIdOrTaxId: form.nationalIdOrTaxId || null,
        email: form.email || null,
        emailConsent: form.email ? form.emailConsent : false,
      });
      toast.success(`Client « ${created.name} » créé`);
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4" /> Nouveau client
            </DialogTitle>
            <DialogDescription>Création rapide : nom et téléphone obligatoires.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Nom"
              htmlFor="qc-name"
              required
              error={errors.name}
              className="sm:col-span-2"
            >
              <Input
                id="qc-name"
                autoFocus
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </FormField>
            <FormField label="Téléphone" htmlFor="qc-phone" required error={errors.phone}>
              <Input
                id="qc-phone"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </FormField>
            <FormField label="Type" htmlFor="qc-type">
              <NativeSelect
                id="qc-type"
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
              >
                {Object.entries(CLIENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={form.type === 'INDIVIDUAL' ? 'CIN' : 'Matricule fiscal'}
              htmlFor="qc-id"
              error={errors.nationalIdOrTaxId}
            >
              <Input
                id="qc-id"
                value={form.nationalIdOrTaxId}
                onChange={(e) => set('nationalIdOrTaxId', e.target.value)}
              />
            </FormField>
            <FormField label="E-mail" htmlFor="qc-email" error={errors.email}>
              <Input
                id="qc-email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </FormField>
            {form.email && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.emailConsent}
                  onCheckedChange={(v) => set('emailConsent', v === true)}
                  className="mt-0.5"
                />
                Le client accepte de recevoir ses documents (factures, avoirs, reçus) par e-mail.
              </label>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={!form.name.trim() || !form.phone.trim()}>
              Créer et choisir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
