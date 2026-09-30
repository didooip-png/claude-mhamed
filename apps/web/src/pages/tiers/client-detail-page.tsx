import { CLIENT_TYPES, EMAIL_DOCUMENT_KINDS } from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import type { Client } from '@/lib/types';
import { ClientFormDialog } from './client-form';
import { ClientTabs } from './client-tabs';
import type { AccountView } from '@/pages/returns/return-types';

/** Fiche client : compte, coordonnées, e-mails et onglets (factures ouvertes, relevé, achats, règlements, retours). */
export function ClientDetailPage() {
  const { id = '' } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const [editing, setEditing] = React.useState(false);
  const client = useQuery({
    queryKey: ['clients', id],
    queryFn: () => api.get<Client>(`/clients/${id}`),
  });
  const account = useQuery({
    queryKey: ['clients', id, 'account'],
    queryFn: () => api.get<AccountView>(`/clients/${id}/account`),
    enabled: can('clients.view'),
  });
  if (client.error)
    return <ErrorState error={client.error} onRetry={() => void client.refetch()} />;
  if (!client.data) return <Skeleton className="h-80" />;
  const c = client.data;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {c.name}
            {!c.isActive && <Badge variant="gray">Inactif</Badge>}
          </span>
        }
        description={`${c.code} · ${CLIENT_TYPES[c.type as keyof typeof CLIENT_TYPES]}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/clients">
                <ArrowLeft /> Clients
              </Link>
            </Button>
            {can('clients.edit') && (
              <Button onClick={() => setEditing(true)}>
                <Pencil /> Modifier
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Compte</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Solde">
                <span
                  className={
                    c.balance > 0
                      ? 'text-lg font-semibold text-destructive'
                      : 'text-lg font-semibold'
                  }
                >
                  {fmt.money(Math.abs(c.balance))}
                </span>
                <div className="text-xs text-muted-foreground">
                  {c.balance > 0 ? 'à payer' : c.balance < 0 ? 'crédit disponible' : 'soldé'}
                </div>
              </Field>
              <Field label="Plafond de crédit">
                {c.creditLimit > 0 ? fmt.money(c.creditLimit) : 'Aucun'}
              </Field>
              <Field label="Crédit disponible (avoirs, acomptes)">
                <span
                  className={
                    (account.data?.availableCredit ?? 0) > 0
                      ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : ''
                  }
                >
                  {fmt.money(account.data?.availableCredit ?? 0)}
                </span>
              </Field>
              <Field label="Plafond restant">
                {c.creditLimit > 0
                  ? fmt.money(
                      account.data?.creditRemaining ??
                        Math.max(0, c.creditLimit - Math.max(0, c.balance)),
                    )
                  : '—'}
              </Field>
              <Field label="Factures échues">
                {(account.data?.overdueCount ?? 0) > 0 ? (
                  <span className="font-medium text-destructive">
                    {account.data!.overdueCount} · {fmt.money(account.data!.overdueAmount)}
                  </span>
                ) : (
                  'Aucune'
                )}
              </Field>
              <Field label="Remise habituelle">
                {c.defaultDiscountBp > 0 ? fmt.percent(c.defaultDiscountBp) : '—'}
              </Field>
              <Field label="Délai de paiement">{c.paymentTermsDays} j</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Coordonnées</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Téléphone">{c.phone ?? '—'}</Field>
              <Field label="Téléphone 2">{c.phone2 ?? '—'}</Field>
              <Field label={c.type === 'INDIVIDUAL' ? 'CIN' : 'Matricule fiscal'}>
                {c.nationalIdOrTaxId ?? '—'}
              </Field>
              <Field label="Adresse">{c.address ?? '—'}</Field>
              <Field label="Client depuis">{fmt.date(c.createdAt)}</Field>
              <Field label="Notes">{c.notes ?? '—'}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Documents par e-mail</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3">
              <Field label="Adresse">
                {c.email ?? '—'} {c.emailBounced && <Badge variant="red">Adresse en échec</Badge>}
              </Field>
              <Field label="Consentement">
                {c.emailConsent ? (
                  <Badge variant="green">Donné le {fmt.dateTime(c.emailConsentAt)}</Badge>
                ) : (
                  <Badge variant="gray">Non donné</Badge>
                )}
              </Field>
              {c.emailConsent && (
                <Field label="Documents souhaités">
                  {Object.entries(EMAIL_DOCUMENT_KINDS)
                    .filter(([k]) => c.emailDocPrefs[k] !== false && k !== 'PURCHASE_ORDER')
                    .map(([, v]) => v)
                    .join(', ')}
                </Field>
              )}
              {c.emailCc.length > 0 && <Field label="En copie">{c.emailCc.join(', ')}</Field>}
            </dl>
          </CardContent>
        </Card>
      </div>
      <ClientTabs client={c} />
      <ClientFormDialog
        client={c}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => void client.refetch()}
      />
    </>
  );
}
