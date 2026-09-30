import {
  ADJUSTMENT_TYPES,
  formatStockQty,
  productLabel,
  type AdjustmentType,
  type Paginated,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, Plus, Printer, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { LotPicker } from '@/components/lot-picker';
import { ErrorState, Field, PageHeader } from '@/components/page';
import { ExpiryBadge } from '@/components/stock-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { platform } from '@/lib/platform';
import type { LotRow } from '@/lib/types';
import type { AdjustmentDetail, AdjustmentRow } from './types';

const STATUS = {
  PENDING: <Badge variant="orange">En attente de validation</Badge>,
  VALIDATED: <Badge variant="green">Validé</Badge>,
  REJECTED: <Badge variant="red">Rejeté</Badge>,
} as const;

const TYPE_LABEL: Record<AdjustmentType, string> = {
  LOSS: 'Perte',
  BREAKAGE: 'Casse',
  EXPIRED_DESTRUCTION: 'Destruction de périmés',
  CORRECTION: 'Correction de stock',
};

async function openPdf(id: string) {
  const pdf = await api.blob(`/adjustments/${id}/print`);
  platform.preview(pdf);
}

interface DraftLine {
  lot: LotRow;
  qty: string;
}

/** Déclaration d'une perte, casse, destruction de périmés ou correction. */
function NewAdjustmentDialog({ onClose }: { onClose: () => void }) {
  const can = useCan();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [type, setType] = React.useState<AdjustmentType>('LOSS');
  const [reason, setReason] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [validateNow, setValidateNow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const addExpired = async () => {
    try {
      const res = await api.get<{ items: LotRow[] }>('/stock/lots', {
        query: { level: 'EXPIRED', withStock: '1', pageSize: 200 },
      });
      const fresh = res.items.filter((l) => !lines.some((x) => x.lot.id === l.id));
      if (fresh.length === 0) return toast.info('Aucun lot périmé en stock.');
      setLines((prev) => [
        ...prev,
        ...fresh.map((lot) => ({ lot, qty: String(lot.remainingQty) })),
      ]);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const submit = async () => {
    if (lines.length === 0) return toast.error('Ajoutez au moins un lot.');
    const parsed = lines.map((l) => ({ lotId: l.lot.id, qty: Number(l.qty) }));
    if (parsed.some((l) => !Number.isInteger(l.qty) || l.qty === 0))
      return toast.error('Quantités invalides.');
    setBusy(true);
    try {
      const adj = await api.post<AdjustmentDetail>('/adjustments', {
        type,
        reason,
        lines: parsed,
        validateNow,
      });
      toast.success(
        adj.status === 'VALIDATED'
          ? `Ajustement ${adj.number} validé`
          : 'Déclaration enregistrée : elle sera validée par un administrateur',
      );
      void qc.invalidateQueries({ queryKey: ['adjustments'] });
      void navigate(`/adjustments/${adj.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Déclarer un ajustement de stock</DialogTitle>
          <DialogDescription>
            Perte, casse, destruction ou correction hors inventaire. Le stock ne change qu’à la
            validation par un administrateur.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nature" required>
            <NativeSelect value={type} onChange={(e) => setType(e.target.value as AdjustmentType)}>
              {Object.entries(TYPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Motif" required>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LotPicker
              className="flex-1"
              excludeIds={lines.map((l) => l.lot.id)}
              onSelect={(lot) =>
                setLines((prev) => [
                  ...prev,
                  { lot, qty: type === 'EXPIRED_DESTRUCTION' ? String(lot.remainingQty) : '1' },
                ])
              }
            />
            {type === 'EXPIRED_DESTRUCTION' && (
              <Button variant="outline" type="button" onClick={() => void addExpired()}>
                Ajouter tous les périmés
              </Button>
            )}
          </div>
          {lines.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH>Lot</TH>
                  <TH className="text-right">En stock</TH>
                  <TH className="w-40 text-right">
                    {type === 'CORRECTION' ? 'Quantité (+/−)' : 'Quantité retirée'}
                  </TH>
                  <TH className="w-10" />
                </TR>
              </THead>
              <TBody>
                {lines.map((l, i) => (
                  <TR key={l.lot.id}>
                    <TD>{productLabel(l.lot.product)}</TD>
                    <TD>
                      <span className="font-mono text-xs">{l.lot.lotNumber}</span>{' '}
                      <ExpiryBadge
                        date={l.lot.expiryDate}
                        level={l.lot.level}
                        days={l.lot.daysToExpiry}
                      />
                    </TD>
                    <TD className="text-right tabular">
                      {formatStockQty(
                        l.lot.remainingQty,
                        l.lot.product.unitsPerPack,
                        l.lot.product.sellByUnit,
                      )}
                    </TD>
                    <TD className="text-right">
                      <Input
                        type="number"
                        className="ml-auto h-8 w-28 text-right tabular"
                        value={l.qty}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                          )
                        }
                      />
                      <div className="text-xs text-muted-foreground">unités de base</div>
                    </TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Retirer"
                        onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        {can('adjustments.validate') && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={validateNow} onCheckedChange={(c) => setValidateNow(c === true)} />
            Valider immédiatement (sinon la déclaration reste en attente)
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={busy || reason.trim().length < 3}>
            {busy && <Loader2 className="animate-spin" />}{' '}
            {validateNow ? 'Enregistrer et valider' : 'Déclarer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustmentsPage() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const state = useTableState();
  const [creating, setCreating] = React.useState(false);
  const filters = { status: state.filter('status'), type: state.filter('type') };
  const list = useQuery({
    queryKey: ['adjustments', 'list', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<AdjustmentRow>>('/adjustments', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
  });
  const columns: Column<AdjustmentRow>[] = [
    {
      id: 'number',
      header: 'N°',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.number ?? 'à valider'}</span>
      ),
    },
    { id: 'type', header: 'Nature', cell: ({ row }) => TYPE_LABEL[row.original.type] },
    { id: 'status', header: 'Statut', cell: ({ row }) => STATUS[row.original.status] },
    {
      id: 'lines',
      header: 'Lots',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.lineCount,
    },
    {
      id: 'reason',
      header: 'Motif',
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-72 text-xs">{row.original.reason}</span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Déclaré le',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.createdAt)}{' '}
          <span className="text-xs text-muted-foreground">{row.original.createdBy?.code}</span>
        </span>
      ),
    },
    {
      id: 'validatedAt',
      header: 'Traité le',
      cell: ({ row }) =>
        row.original.validatedAt ? (
          <span className="tabular">
            {fmt.dateTime(row.original.validatedAt)}{' '}
            <span className="text-xs text-muted-foreground">{row.original.validatedBy?.code}</span>
          </span>
        ) : (
          '—'
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Ajustements de stock"
        description="Pertes, casses, destructions de périmés et corrections hors inventaire."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Déclarer
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="N° ou motif…"
        onRowClick={(r) => void navigate(`/adjustments/${r.id}`)}
        emptyTitle="Aucun ajustement"
        toolbar={
          <>
            <NativeSelect
              className="w-44"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous les statuts</option>
              <option value="PENDING">En attente</option>
              <option value="VALIDATED">Validés</option>
              <option value="REJECTED">Rejetés</option>
            </NativeSelect>
            <NativeSelect
              className="w-52"
              value={filters.type}
              onChange={(e) => state.update({ type: e.target.value })}
              aria-label="Nature"
            >
              <option value="">Toutes les natures</option>
              {Object.entries(ADJUSTMENT_TYPES).map(([k]) => (
                <option key={k} value={k}>
                  {TYPE_LABEL[k as AdjustmentType]}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
      {creating && <NewAdjustmentDialog onClose={() => setCreating(false)} />}
    </>
  );
}

export function AdjustmentDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const adj = useQuery({
    queryKey: ['adjustments', id],
    queryFn: () => api.get<AdjustmentDetail>(`/adjustments/${id}`),
    enabled: !!id,
  });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['adjustments'] });
    void qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const validate = useMutation({
    mutationFn: () => api.post(`/adjustments/${id}/validate`),
    onSuccess: () => {
      toast.success('Ajustement validé : le stock est corrigé');
      done();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/adjustments/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('Ajustement rejeté');
      setRejecting(false);
      done();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  if (adj.error) return <ErrorState error={adj.error} onRetry={() => void adj.refetch()} />;
  if (!adj.data) return <Skeleton className="h-96" />;
  const a = adj.data;
  const pending = a.status === 'PENDING';
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {TYPE_LABEL[a.type]} {a.number ?? ''} {STATUS[a.status]}
          </span>
        }
        description={`Déclaré le ${fmt.dateTime(a.createdAt)} par ${a.createdBy?.code ?? ''} — ${a.createdBy?.fullName ?? ''}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/adjustments">
                <ArrowLeft /> Ajustements
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void openPdf(a.id).catch((e: unknown) => toast.error(errorText(e)))}
            >
              <Printer />{' '}
              {a.type === 'EXPIRED_DESTRUCTION'
                ? 'Procès-verbal de destruction'
                : 'Bon d’ajustement'}
            </Button>
            {pending && can('adjustments.validate') && (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  <X /> Rejeter
                </Button>
                <Button onClick={() => validate.mutate()} disabled={validate.isPending}>
                  <Check /> Valider
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Lots concernés</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Lot</TH>
                <TH className="text-right">Quantité</TH>
                <TH className="text-right">En stock</TH>
                {a.totalValueAtCost !== null && <TH className="text-right">Valeur (coût)</TH>}
              </TR>
            </THead>
            <TBody>
              {a.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.product ? productLabel(l.product) : '—'}</TD>
                  <TD className="font-mono text-xs">
                    {l.lot?.lotNumber}
                    {l.lot && (
                      <div className="font-sans text-muted-foreground">
                        exp. {fmt.isoDate(l.lot.expiryDate)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {l.qty > 0 ? '+' : '−'}
                    {l.product
                      ? formatStockQty(
                          Math.abs(l.qty),
                          l.product.unitsPerPack,
                          l.product.sellByUnit,
                        )
                      : Math.abs(l.qty)}
                  </TD>
                  <TD className="text-right tabular">
                    {l.lot && l.product
                      ? formatStockQty(
                          l.lot.remainingQty,
                          l.product.unitsPerPack,
                          l.product.sellByUnit,
                        )
                      : '—'}
                  </TD>
                  {a.totalValueAtCost !== null && (
                    <TD className="text-right tabular">{fmt.money(l.valueAtCost ?? 0)}</TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <Field label="Motif">{a.reason}</Field>
            {a.rejectedReason && <Field label="Motif du rejet">{a.rejectedReason}</Field>}
            {a.totalValueAtCost !== null && (
              <Field label="Valeur totale au coût">{fmt.money(a.totalValueAtCost)}</Field>
            )}
            {a.validatedAt && (
              <Field label={a.status === 'REJECTED' ? 'Rejeté le' : 'Validé le'}>
                {fmt.dateTime(a.validatedAt)} par {a.validatedBy?.code}
              </Field>
            )}
            {can('audit.view') && (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to={`/audit?entityId=${a.id}`}>Historique au mouchard</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter la déclaration</DialogTitle>
            <DialogDescription>Le stock reste inchangé.</DialogDescription>
          </DialogHeader>
          <FormField label="Motif du rejet" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              Retour
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => reject.mutate()}
            >
              Rejeter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
