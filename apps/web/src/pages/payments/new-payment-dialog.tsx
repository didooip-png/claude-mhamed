import { PAYMENT_METHODS, type PaymentMethod } from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField, MoneyInput } from '@/components/form';
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
import { Checkbox } from '@/components/ui/misc';
import { api, ApiError, errorText, newIdempotencyKey } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import { ClientSearch } from '@/pages/sales/pos-client';
import type { AccountView, OpenInvoice, PaymentDetail } from '../returns/return-types';

type Method = Exclude<PaymentMethod, 'CREDIT_NOTE'>;
type Allocation = 'AUTO' | 'MANUAL' | 'NONE';

interface ClientInfo {
  id: string;
  name: string;
  email: string | null;
  emailConsent: boolean;
  emailDocPrefs: Record<string, boolean> | null;
}

async function printReceipt(id: string) {
  const pdf = await api.blob(`/payments/${id}/print`, { query: { format: 'TICKET' } });
  await platform.print(pdf, { format: 'TICKET' });
}

/**
 * Encaissement (§6.10) : client, mode, montant, lettrage automatique (factures les plus anciennes
 * d'abord), manuel facture par facture, ou acompte (crédit client).
 */
export function NewPaymentDialog({
  clientId,
  onClose,
  onDone,
}: {
  clientId?: string;
  onClose: () => void;
  onDone: (payment: PaymentDetail) => void;
}) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const [client, setClient] = React.useState<ClientInfo | null>(null);
  const [method, setMethod] = React.useState<Method>('CASH');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [allocation, setAllocation] = React.useState<Allocation>('AUTO');
  const [manual, setManual] = React.useState<Record<string, number | null>>({});
  const [details, setDetails] = React.useState({
    chequeNumber: '',
    bank: '',
    dueDate: '',
    reference: '',
    notes: '',
  });
  const [sendEmail, setSendEmail] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!clientId) return;
    api
      .get<ClientInfo>(`/clients/${clientId}`)
      .then(setClient)
      .catch((err: unknown) => toast.error(errorText(err)));
  }, [clientId]);

  const invoices = useQuery({
    queryKey: ['clients', client?.id, 'open-invoices'],
    queryFn: () => api.get<OpenInvoice[]>(`/clients/${client!.id}/open-invoices`),
    enabled: !!client,
  });
  const account = useQuery({
    queryKey: ['clients', client?.id, 'account'],
    queryFn: () => api.get<AccountView>(`/clients/${client!.id}/account`),
    enabled: !!client,
  });
  const emailStatus = useQuery({
    queryKey: ['email', 'status'],
    queryFn: () => api.get<{ operational: boolean }>('/email/status'),
    staleTime: 60_000,
  });

  const open = React.useMemo(() => invoices.data ?? [], [invoices.data]);
  const due = open.reduce((a, i) => a + i.amountDue, 0);
  const emailPossible = !!emailStatus.data?.operational && !!client?.email;

  React.useEffect(() => {
    setSendEmail(
      !!client?.email && client.emailConsent && client.emailDocPrefs?.PAYMENT_RECEIPT !== false,
    );
  }, [client]);

  // Répartition affichée (automatique : plus anciennes d'abord).
  const plan = React.useMemo(() => {
    const out = new Map<string, number>();
    if (allocation === 'AUTO') {
      let rest = amount ?? 0;
      for (const i of open) {
        const take = Math.min(rest, i.amountDue);
        if (take > 0) out.set(i.id, take);
        rest -= take;
      }
    } else if (allocation === 'MANUAL') {
      for (const [id, v] of Object.entries(manual)) if (v && v > 0) out.set(id, v);
    }
    return out;
  }, [allocation, amount, manual, open]);
  const allocated = [...plan.values()].reduce((a, v) => a + v, 0);
  const acompte = (amount ?? 0) - allocated;
  const manualTooMuch = allocation === 'MANUAL' && allocated > (amount ?? 0);
  const manualOver = allocation === 'MANUAL' && open.some((i) => (manual[i.id] ?? 0) > i.amountDue);

  const validationErrors: string[] = [];
  if (!client) validationErrors.push('Choisissez le client.');
  if (!amount || amount <= 0) validationErrors.push('Saisissez le montant.');
  if (method === 'CHEQUE' && (!details.chequeNumber.trim() || !details.bank.trim()))
    validationErrors.push('N° de chèque et banque obligatoires.');
  if (method === 'TRANSFER' && !details.reference.trim())
    validationErrors.push('Référence du virement obligatoire.');
  if (method === 'DRAFT_BILL' && !details.dueDate)
    validationErrors.push('Échéance de la traite obligatoire.');
  if (manualTooMuch) validationErrors.push('Les montants affectés dépassent le règlement.');
  if (manualOver) validationErrors.push('Une affectation dépasse le reste dû d’une facture.');
  if (allocation === 'MANUAL' && allocated === 0)
    validationErrors.push('Indiquez les factures à régler (ou choisissez « Acompte »).');

  const submit = async () => {
    if (!client || !amount) return;
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<{ payment: PaymentDetail; warnings: string[] }>(
        '/payments',
        {
          clientId: client.id,
          method,
          amount,
          allocation,
          items:
            allocation === 'MANUAL'
              ? [...plan.entries()].map(([saleId, a]) => ({ saleId, amount: a }))
              : [],
          chequeNumber: method === 'CHEQUE' ? details.chequeNumber.trim() : null,
          bank: method === 'CHEQUE' ? details.bank.trim() : null,
          dueDate: method === 'CHEQUE' || method === 'DRAFT_BILL' ? details.dueDate || null : null,
          reference:
            method === 'TRANSFER' || method === 'DRAFT_BILL'
              ? details.reference.trim() || null
              : null,
          notes: details.notes.trim() || null,
          sendEmail: emailPossible ? sendEmail : false,
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['cash'] });
      toast.success(`Règlement ${res.payment.number} enregistré.`, {
        action: {
          label: 'Imprimer le reçu',
          onClick: () =>
            void printReceipt(res.payment.id).catch((e: unknown) => toast.error(errorText(e))),
        },
        duration: 10_000,
      });
      res.warnings.forEach((w) => toast.warning(w));
      onDone(res.payment);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validationErrors.length === 0) void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-4" /> Nouvel encaissement
            </DialogTitle>
            <DialogDescription>
              Numéro REG- attribué à l’enregistrement ; un reçu est imprimable.
            </DialogDescription>
          </DialogHeader>

          {client ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
              <strong>{client.name}</strong>
              {account.data && (
                <>
                  <span
                    className={account.data.balance > 0 ? 'text-destructive' : 'text-emerald-700'}
                  >
                    {account.data.balance > 0
                      ? `Doit ${fmt.money(account.data.balance)}`
                      : account.data.balance < 0
                        ? `Crédit ${fmt.money(-account.data.balance)}`
                        : 'Compte soldé'}
                  </span>
                  {account.data.overdueCount > 0 && (
                    <Badge variant="red">{account.data.overdueCount} facture(s) échue(s)</Badge>
                  )}
                </>
              )}
              {!clientId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setClient(null)}
                >
                  Changer
                </Button>
              )}
            </div>
          ) : (
            <ClientSearch
              autoFocus
              onSelect={(c) =>
                setClient({
                  id: c.id,
                  name: c.name,
                  email: c.email,
                  emailConsent: false,
                  emailDocPrefs: null,
                })
              }
            />
          )}

          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Mode" className="w-44">
              <NativeSelect
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                aria-label="Mode de règlement"
              >
                {(['CASH', 'CARD', 'CHEQUE', 'TRANSFER', 'DRAFT_BILL'] as const).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHODS[m]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Montant reçu" className="w-44" error={errors.amount}>
              <MoneyInput
                value={amount}
                onValueChange={setAmount}
                aria-label="Montant reçu"
                autoFocus={!!clientId}
              />
            </FormField>
            {method === 'CHEQUE' && (
              <>
                <FormField label="N° de chèque" className="w-36" error={errors.chequeNumber}>
                  <Input
                    value={details.chequeNumber}
                    onChange={(e) => setDetails((d) => ({ ...d, chequeNumber: e.target.value }))}
                  />
                </FormField>
                <FormField label="Banque" className="w-36">
                  <Input
                    value={details.bank}
                    onChange={(e) => setDetails((d) => ({ ...d, bank: e.target.value }))}
                  />
                </FormField>
              </>
            )}
            {(method === 'CHEQUE' || method === 'DRAFT_BILL') && (
              <FormField label="Échéance" className="w-44" error={errors.dueDate}>
                <Input
                  type="date"
                  value={details.dueDate}
                  onChange={(e) => setDetails((d) => ({ ...d, dueDate: e.target.value }))}
                />
              </FormField>
            )}
            {(method === 'TRANSFER' || method === 'DRAFT_BILL') && (
              <FormField label="Référence" className="w-48" error={errors.reference}>
                <Input
                  value={details.reference}
                  onChange={(e) => setDetails((d) => ({ ...d, reference: e.target.value }))}
                />
              </FormField>
            )}
          </div>

          <FormField label="Lettrage">
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ['AUTO', 'Automatique (factures les plus anciennes d’abord)'],
                  ['MANUAL', 'Manuel, facture par facture'],
                  ['NONE', 'Acompte (aucune facture)'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="alloc"
                    checked={allocation === k}
                    onChange={() => setAllocation(k)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </FormField>

          {allocation !== 'NONE' && client && (
            <div className="max-h-64 overflow-auto rounded-md border">
              {invoices.isLoading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Chargement des factures…
                </div>
              ) : open.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Aucune facture ouverte : le règlement sera un acompte.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Facture</th>
                      <th className="px-3 py-1.5 text-left font-medium">Date</th>
                      <th className="px-3 py-1.5 text-left font-medium">Échéance</th>
                      <th className="px-3 py-1.5 text-right font-medium">Reste dû</th>
                      <th className="px-3 py-1.5 text-right font-medium">Affecté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((i) => (
                      <tr key={i.id} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-xs">{i.number}</td>
                        <td className="px-3 py-1.5 tabular">{fmt.date(i.validatedAt)}</td>
                        <td className="px-3 py-1.5">
                          {i.dueDate ? fmt.isoDate(i.dueDate) : '—'}
                          {i.overdueDays > 0 && (
                            <Badge variant="red" className="ml-1">
                              +{i.overdueDays} j
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">{fmt.money(i.amountDue)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {allocation === 'AUTO' ? (
                            <span className="tabular">
                              {plan.get(i.id) ? fmt.money(plan.get(i.id)!) : '—'}
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <MoneyInput
                                className="h-7 w-28"
                                value={manual[i.id] ?? null}
                                onValueChange={(v) => setManual((m) => ({ ...m, [i.id]: v }))}
                                aria-label={`Montant affecté à ${i.number}`}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  setManual((m) => ({
                                    ...m,
                                    [i.id]:
                                      Math.min(
                                        i.amountDue,
                                        Math.max(0, (amount ?? 0) - allocated + (m[i.id] ?? 0)),
                                      ) || null,
                                  }))
                                }
                              >
                                Solder
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <span>
              Affecté aux factures : <strong className="tabular">{fmt.money(allocated)}</strong>
              {due > 0 && <span className="text-muted-foreground"> (dû : {fmt.money(due)})</span>}
            </span>
            <span
              className={acompte > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}
            >
              {acompte > 0 ? `Acompte (crédit client) : ${fmt.money(acompte)}` : 'Aucun acompte'}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Remarque" className="min-w-64 flex-1">
              <Input
                value={details.notes}
                onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
              />
            </FormField>
            {emailPossible && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
                Envoyer le reçu par e-mail
              </label>
            )}
          </div>
          {validationErrors.length > 0 && amount !== null && (
            <ul className="text-sm text-destructive">
              {validationErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={validationErrors.length > 0}>
              Enregistrer le règlement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
