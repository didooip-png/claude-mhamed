import { PAYMENT_METHODS, type PaymentInput } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, Landmark, Plus, ScrollText, Trash2, Wallet } from 'lucide-react';
import * as React from 'react';
import { FormField, MoneyInput } from '@/components/form';
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
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { SaleView } from './sale-types';

type Method = PaymentInput['method'];

interface PaymentRow {
  key: number;
  method: Method;
  amount: number | null;
  tendered: number | null;
  chequeNumber: string;
  bank: string;
  dueDate: string;
  reference: string;
}

export interface ValidatePayload {
  payments: PaymentInput[];
  useCredit: number;
  document: 'TICKET' | 'A4' | 'NONE';
  sendEmail: boolean;
  emailTo: string | null;
  pin?: string;
}

const METHOD_ICONS: Record<Method, React.ReactNode> = {
  CASH: <Banknote />,
  CARD: <CreditCard />,
  CHEQUE: <ScrollText />,
  TRANSFER: <Landmark />,
  DRAFT_BILL: <ScrollText />,
};

let rowKey = 0;
const newRow = (method: Method, amount: number | null): PaymentRow => ({
  key: ++rowKey,
  method,
  amount,
  tendered: null,
  chequeNumber: '',
  bank: '',
  dueDate: '',
  reference: '',
});

/** Paiement (F9) : modes combinés, rendu monnaie, avoir / crédit client, reste sur le compte (§6.6). */
export function PaymentDialog({
  sale,
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  sale: SaleView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ValidatePayload) => void;
  busy: boolean;
}) {
  const fmt = useFormat();
  const settings = useSettings();
  const can = useCan();
  const total = sale.totals.totalTtc;
  const client = sale.client;
  const walkIn = !client || client.isWalkIn;
  const available = walkIn ? 0 : (client?.account.availableCredit ?? 0);
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });
  const invoiceMode = settings['email.auto_send'].INVOICE;
  const emailPossible = !walkIn && invoiceMode !== 'DISABLED' && !!emailStatus.data?.operational;

  const [useCredit, setUseCredit] = React.useState(0);
  const [rows, setRows] = React.useState<PaymentRow[]>([]);
  const [document, setDocument] = React.useState<ValidatePayload['document']>(
    settings['sales.default_document'],
  );
  const [sendEmail, setSendEmail] = React.useState(false);
  const [emailTo, setEmailTo] = React.useState('');
  const [pin, setPin] = React.useState('');
  const firstAmount = React.useRef<HTMLInputElement>(null);

  // Initialisation à l'ouverture : avoir proposé automatiquement, puis espèces pour le reste.
  React.useEffect(() => {
    if (!open) return;
    const credit = Math.min(available, total);
    setUseCredit(credit);
    setRows(total - credit > 0 ? [newRow('CASH', total - credit)] : []);
    setDocument(settings['sales.default_document']);
    setSendEmail(
      !!client?.email &&
        client.emailConsent &&
        invoiceMode === 'AUTO' &&
        client.emailDocPrefs?.INVOICE !== false,
    );
    setEmailTo(client?.email ?? '');
    setPin('');
    window.setTimeout(() => firstAmount.current?.select(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (open && emailStatus.data && !emailPossible) setSendEmail(false);
  }, [open, emailStatus.data, emailPossible]);

  const paid = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  const covered = paid + useCredit;
  const remaining = total - covered;
  const cashRow = rows.find((r) => r.method === 'CASH');
  const change =
    cashRow && cashRow.tendered !== null && cashRow.amount !== null
      ? cashRow.tendered - cashRow.amount
      : 0;
  const creditLimitWarning =
    remaining > 0 &&
    client &&
    !walkIn &&
    client.account.balance + remaining > client.account.creditLimit;
  const pinRequired = settings['sales.require_pin_on_validation'];

  const rowErrors = rows.map((r) => {
    if (!r.amount || r.amount <= 0) return 'Montant obligatoire';
    if (r.method === 'CHEQUE' && (!r.chequeNumber.trim() || !r.bank.trim()))
      return 'N° de chèque et banque obligatoires';
    if (r.method === 'TRANSFER' && !r.reference.trim()) return 'Référence du virement obligatoire';
    if (r.method === 'DRAFT_BILL' && !r.dueDate) return 'Échéance obligatoire';
    if (r.method === 'CASH' && r.tendered !== null && r.tendered < (r.amount ?? 0))
      return 'Montant remis insuffisant';
    return null;
  });
  const errors: string[] = [];
  if (remaining < 0) errors.push(`Les règlements dépassent le total de ${fmt.money(-remaining)}.`);
  if (remaining > 0 && walkIn) errors.push('Le client comptoir doit régler la totalité.');
  if (remaining > 0 && !walkIn && !can('sales.credit'))
    errors.push('Vous n’êtes pas autorisé à vendre à crédit.');
  if (useCredit > available) errors.push('Crédit disponible insuffisant.');
  if (pinRequired && !/^\d{4,6}$/.test(pin)) errors.push('Saisissez votre PIN.');
  if (sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim()))
    errors.push('Adresse e-mail invalide.');
  const canSubmit = !busy && errors.length === 0 && rowErrors.every((e) => e === null);

  const update = (key: number, patch: Partial<PaymentRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Crédit utilisé modifié : un règlement unique s'ajuste au reste à payer. */
  const changeCredit = (value: number | null) => {
    const credit = Math.min(value ?? 0, available, total);
    setUseCredit(credit);
    const rest = total - credit;
    setRows((rs) => {
      if (rs.length === 1) return [{ ...rs[0]!, amount: rest > 0 ? rest : null }];
      if (rs.length === 0 && rest > 0) return [newRow('CASH', rest)];
      return rs;
    });
  };

  const addMethod = (method: Method) => {
    setRows((rs) => [...rs, newRow(method, Math.max(0, remaining) || null)]);
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      payments: rows.map((r) => ({
        method: r.method,
        amount: r.amount ?? 0,
        ...(r.method === 'CASH' && r.tendered !== null ? { tendered: r.tendered } : {}),
        ...(r.method === 'CHEQUE'
          ? { chequeNumber: r.chequeNumber.trim(), bank: r.bank.trim(), dueDate: r.dueDate || null }
          : {}),
        ...(r.method === 'TRANSFER' ? { reference: r.reference.trim() } : {}),
        ...(r.method === 'DRAFT_BILL'
          ? { dueDate: r.dueDate, reference: r.reference.trim() || null }
          : {}),
      })),
      useCredit,
      document,
      sendEmail: emailPossible && sendEmail,
      emailTo:
        emailPossible && sendEmail && emailTo.trim() !== (client?.email ?? '')
          ? emailTo.trim()
          : null,
      ...(pinRequired ? { pin } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="lg"
        onKeyDown={(e) => {
          if (e.key === 'F10' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-4" /> Paiement
            </DialogTitle>
            <DialogDescription>
              {client ? client.name : 'Client comptoir'} · {sale.lines.length} ligne(s)
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-baseline justify-between rounded-lg bg-primary/5 px-4 py-3">
            <span className="text-sm font-medium">Total à payer</span>
            <span className="text-3xl font-bold tabular">{fmt.money(total)}</span>
          </div>

          {available > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                Crédit disponible : {fmt.money(available)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Utiliser</span>
                <MoneyInput
                  className="h-8 w-32"
                  value={useCredit}
                  onValueChange={changeCredit}
                  aria-label="Montant du crédit utilisé"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-md border p-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <FormField label="Mode" className="w-full sm:w-40">
                    <NativeSelect
                      value={r.method}
                      onChange={(e) =>
                        update(r.key, { method: e.target.value as Method, tendered: null })
                      }
                      aria-label="Mode de paiement"
                    >
                      {(['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL'] as const).map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHODS[m]}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Montant" className="w-full sm:w-40">
                    <MoneyInput
                      ref={i === 0 ? firstAmount : undefined}
                      value={r.amount}
                      onValueChange={(v) => update(r.key, { amount: v })}
                      aria-label="Montant"
                    />
                  </FormField>
                  {r.method === 'CASH' && (
                    <>
                      <FormField
                        label="Montant remis"
                        className="w-full sm:w-40"
                        help="La somme réellement donnée par le client. Le rendu de monnaie se calcule tout seul. Laissez le montant à régler si le client donne le compte juste."
                      >
                        <MoneyInput
                          value={r.tendered}
                          onValueChange={(v) => update(r.key, { tendered: v })}
                          aria-label="Montant remis"
                        />
                      </FormField>
                      {change > 0 && (
                        <div className="pb-1.5 text-sm">
                          Rendu :{' '}
                          <span className="text-lg font-bold text-emerald-700 tabular dark:text-emerald-400">
                            {fmt.money(change)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {r.method === 'CHEQUE' && (
                    <>
                      <FormField label="N° de chèque" className="w-full sm:w-32">
                        <Input
                          value={r.chequeNumber}
                          onChange={(e) => update(r.key, { chequeNumber: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Banque" className="w-full sm:w-32">
                        <Input
                          value={r.bank}
                          onChange={(e) => update(r.key, { bank: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Échéance" className="w-full sm:w-40">
                        <Input
                          type="date"
                          value={r.dueDate}
                          onChange={(e) => update(r.key, { dueDate: e.target.value })}
                        />
                      </FormField>
                    </>
                  )}
                  {r.method === 'TRANSFER' && (
                    <FormField label="Référence" className="w-full sm:w-48">
                      <Input
                        value={r.reference}
                        onChange={(e) => update(r.key, { reference: e.target.value })}
                      />
                    </FormField>
                  )}
                  {r.method === 'DRAFT_BILL' && (
                    <>
                      <FormField label="Échéance" className="w-full sm:w-40">
                        <Input
                          type="date"
                          value={r.dueDate}
                          onChange={(e) => update(r.key, { dueDate: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Référence" className="w-full sm:w-36">
                        <Input
                          value={r.reference}
                          onChange={(e) => update(r.key, { reference: e.target.value })}
                        />
                      </FormField>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    aria-label="Retirer ce règlement"
                  >
                    <Trash2 />
                  </Button>
                </div>
                {rowErrors[i] && <p className="mt-1 text-xs text-destructive">{rowErrors[i]}</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL'] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addMethod(m)}
                >
                  <Plus /> {METHOD_ICONS[m]} {PAYMENT_METHODS[m]}
                </Button>
              ))}
            </div>
          </div>

          <div
            className={cn(
              'flex items-baseline justify-between rounded-md px-3 py-2 text-sm',
              remaining > 0
                ? 'bg-amber-50 dark:bg-amber-950/40'
                : remaining < 0
                  ? 'bg-destructive/10'
                  : 'bg-muted',
            )}
          >
            <span>
              {remaining > 0
                ? 'Reste à payer (sur le compte du client, à crédit)'
                : remaining < 0
                  ? 'Excédent'
                  : 'Réglé intégralement'}
            </span>
            <span className="text-lg font-semibold tabular">{fmt.money(Math.abs(remaining))}</span>
          </div>
          {creditLimitWarning && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Le plafond de crédit du client ({fmt.money(client!.account.creditLimit)}) sera dépassé
              : une autorisation administrateur sera demandée.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Document">
              <NativeSelect
                value={document}
                onChange={(e) => setDocument(e.target.value as ValidatePayload['document'])}
                aria-label="Document à imprimer"
              >
                <option value="TICKET">Ticket 80 mm</option>
                <option value="A4">Facture A4</option>
                <option value="NONE">Pas d’impression</option>
              </NativeSelect>
            </FormField>
            {pinRequired && (
              <FormField label="Votre PIN" required>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </FormField>
            )}
          </div>
          {emailPossible && (
            <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
                Envoyer la facture par e-mail
              </label>
              {sendEmail && (
                <>
                  <Input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="adresse@exemple.com"
                    aria-label="Adresse e-mail"
                  />
                  {!client?.emailConsent && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Ce client n’a pas donné son consentement à l’envoi par e-mail : cocher la case
                      vaut confirmation explicite de l’envoi.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <ul className="text-sm text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Retour
            </Button>
            <Button type="submit" size="lg" disabled={!canSubmit} loading={busy}>
              Valider la vente{' '}
              <Kbd className="bg-primary-foreground/20 text-primary-foreground">F10</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
