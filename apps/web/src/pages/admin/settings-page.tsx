import {
  DOC_AUTO_MODES,
  EMAIL_DOCUMENT_KINDS,
  WEEK_DAY_LABELS,
  type SettingsMap,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { MoneyInput, PercentInput } from '@/components/form';
import { ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, errorText } from '@/lib/api';

interface JsonSchema {
  type?: string;
  enum?: string[];
  anyOf?: JsonSchema[];
}

interface SettingsResponse {
  groups: Record<string, string>;
  definitions: Record<
    string,
    { group: string; label: string; help: string | null; schema: JsonSchema }
  >;
  values: SettingsMap;
}

const MONEY_KEYS = new Set(['tax.stamp_duty_amount', 'cash.discrepancy_threshold']);
const BP_KEYS = new Set(['sales.preparer_max_discount_bp']);
const ENUM_LABELS: Record<string, Record<string, string>> = {
  'stock.exit_rule': {
    FEFO: 'FEFO — premier périmé, premier sorti',
    FIFO: 'FIFO strict — premier reçu, premier sorti',
  },
  'tax.stamp_duty_scope': {
    PROFESSIONAL: 'Clients professionnels',
    ALL: 'Toutes les ventes',
    NONE: 'Jamais',
  },
  'sales.prescription_required_for': {
    PRESCRIPTION_AND_CONTROLLED: 'Produits sur ordonnance et produits à tableau',
    CONTROLLED_ONLY: 'Produits à tableau uniquement',
    NONE: 'Jamais',
  },
  'sales.default_document': { TICKET: 'Ticket 80 mm', A4: 'Facture A4', NONE: 'Aucun' },
};
const AUTO_LABELS: Record<(typeof DOC_AUTO_MODES)[number], string> = {
  AUTO: 'Automatique',
  MANUAL: 'Manuel uniquement',
  DISABLED: 'Désactivé',
};

type Values = Record<string, unknown>;

function SettingEditor({
  k,
  schema,
  value,
  onChange,
}: {
  k: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (MONEY_KEYS.has(k))
    return (
      <MoneyInput
        className="max-w-40"
        value={value as number}
        onValueChange={(v) => onChange(v ?? 0)}
      />
    );
  if (BP_KEYS.has(k))
    return <PercentInput className="max-w-28" value={value as number} onValueChange={onChange} />;
  if (k === 'general.business_hours')
    return (
      <BusinessHoursEditor
        value={value as SettingsMap['general.business_hours']}
        onChange={onChange}
      />
    );
  if (k === 'cash.denominations')
    return (
      <DenominationsEditor value={value as SettingsMap['cash.denominations']} onChange={onChange} />
    );
  if (k === 'numbering.prefixes') {
    const v = value as Record<string, string>;
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Object.entries(v).map(([doc, prefix]) => (
          <label key={doc} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {doc}
            <Input
              value={prefix}
              maxLength={8}
              onChange={(e) => onChange({ ...v, [doc]: e.target.value.toUpperCase() })}
            />
          </label>
        ))}
      </div>
    );
  }
  if (k === 'email.auto_send') {
    const v = value as Record<string, string>;
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(EMAIL_DOCUMENT_KINDS).map(([kind, label]) => (
          <label key={kind} className="flex items-center justify-between gap-2 text-sm">
            {label}
            <NativeSelect
              className="w-44"
              value={v[kind]}
              onChange={(e) => onChange({ ...v, [kind]: e.target.value })}
            >
              {DOC_AUTO_MODES.map((m) => (
                <option key={m} value={m}>
                  {AUTO_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>
    );
  }
  if (schema.type === 'boolean')
    return <Switch checked={value as boolean} onCheckedChange={onChange} />;
  if (schema.enum) {
    return (
      <NativeSelect
        className="max-w-md"
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
      >
        {schema.enum.map((opt) => (
          <option key={opt} value={opt}>
            {ENUM_LABELS[k]?.[opt] ?? opt}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return (
      <Input
        type="number"
        className="max-w-32 text-right tabular"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }
  if (schema.type === 'array') {
    const arr = value as number[];
    return (
      <Input
        className="max-w-xs"
        defaultValue={arr.join(', ')}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(/[,;\s]+/)
              .filter(Boolean)
              .map(Number)
              .filter((n) => Number.isFinite(n)),
          )
        }
        placeholder="90, 60, 30"
      />
    );
  }
  if (k === 'establishment.primary_color') {
    return (
      <Input
        type="color"
        className="h-9 w-20 p-1"
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (k === 'establishment.logo_attachment_id') {
    return (
      <span className="text-sm text-muted-foreground">
        Le logo se charge depuis l’écran « Établissement » (bientôt disponible).
      </span>
    );
  }
  const long = k === 'establishment.legal_footer' || k === 'establishment.address';
  return (
    <Input
      className={long ? 'max-w-2xl' : 'max-w-md'}
      value={(value as string | null) ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: SettingsMap['general.business_hours'];
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {(Object.keys(WEEK_DAY_LABELS) as (keyof typeof WEEK_DAY_LABELS)[]).map((day) => {
        const ranges = value[day];
        return (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm">{WEEK_DAY_LABELS[day]}</span>
            {ranges.length === 0 && <span className="text-sm text-muted-foreground">Fermé</span>}
            {ranges.map((r, i) => (
              <span key={i} className="flex items-center gap-1">
                <Input
                  type="time"
                  className="w-28"
                  value={r.open}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [day]: ranges.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)),
                    })
                  }
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  className="w-28"
                  value={r.close}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [day]: ranges.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Retirer la plage"
                  onClick={() => onChange({ ...value, [day]: ranges.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </span>
            ))}
            {ranges.length < 3 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({ ...value, [day]: [...ranges, { open: '08:00', close: '18:00' }] })
                }
              >
                <Plus /> Plage
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DenominationsEditor({
  value,
  onChange,
}: {
  value: SettingsMap['cash.denominations'];
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <MoneyInput
            className="w-36"
            value={d.value}
            onValueChange={(v) =>
              onChange(value.map((x, j) => (j === i ? { ...x, value: v ?? 0 } : x)))
            }
          />
          <Input
            className="max-w-56"
            value={d.label}
            onChange={(e) =>
              onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Retirer"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...value, { value: 1000, label: 'Nouvelle coupure' }])}
      >
        <Plus /> Ajouter une coupure
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'admin'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
  });
  const [draft, setDraft] = React.useState<Values>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (query.data) setDraft(structuredClone(query.data.values) as Values);
  }, [query.data]);

  const changed = React.useMemo(() => {
    if (!query.data) return {};
    const out: Values = {};
    for (const [k, v] of Object.entries(draft)) {
      if (JSON.stringify(v) !== JSON.stringify((query.data.values as Values)[k])) out[k] = v;
    }
    return out;
  }, [draft, query.data]);

  const save = useMutation({
    mutationFn: () => api.put<SettingsMap>('/settings', { values: changed }),
    onSuccess: () => {
      toast.success(
        `${Object.keys(changed).length} paramètre(s) enregistré(s) — modification tracée au mouchard`,
      );
      setErrors({});
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data || Object.keys(draft).length === 0) return <Skeleton className="h-96" />;
  const { groups, definitions } = query.data;
  const groupKeys = Object.keys(groups);
  const dirtyCount = Object.keys(changed).length;

  return (
    <>
      <PageHeader
        title="Paramètres"
        description="Paramètres métier de l’établissement. Chaque modification est tracée au mouchard (avant / après)."
        actions={
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={dirtyCount === 0}
          >
            <Save /> Enregistrer{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
          </Button>
        }
      />
      <Tabs defaultValue={groupKeys[0]}>
        <TabsList className="h-auto flex-wrap">
          {groupKeys.map((g) => (
            <TabsTrigger key={g} value={g}>
              {groups[g]}
            </TabsTrigger>
          ))}
        </TabsList>
        {groupKeys.map((g) => (
          <TabsContent key={g} value={g}>
            <Card>
              <CardHeader>
                <CardTitle>{groups[g]}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {Object.entries(definitions)
                  .filter(([, d]) => d.group === g)
                  .map(([k, d]) => (
                    <div
                      key={k}
                      className="grid gap-2 py-3 md:grid-cols-[minmax(0,320px)_1fr] md:gap-6"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {d.label}
                          {k in changed && (
                            <span className="ml-2 text-xs font-normal text-warning">modifié</span>
                          )}
                        </div>
                        {d.help && <p className="mt-0.5 text-xs text-muted-foreground">{d.help}</p>}
                      </div>
                      <div>
                        <SettingEditor
                          k={k}
                          schema={d.schema}
                          value={draft[k]}
                          onChange={(v) => setDraft((prev) => ({ ...prev, [k]: v }))}
                        />
                        {errors[k] && <p className="mt-1 text-xs text-destructive">{errors[k]}</p>}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
