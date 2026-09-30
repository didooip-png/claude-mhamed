import { NOTIFIABLE_EVENTS, type Paginated } from '@pharmastock/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Eye,
  KeyRound,
  Mail,
  PlugZap,
  RotateCcw,
  Save,
  Send,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { DataTable, useTableState, type Column } from '@/components/data-table';
import { FormField } from '@/components/form';
import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, errorText } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EMAIL_STATUS } from '@/pages/sales/sales-pages';

interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  security: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  bccArchive: string;
  hourlyLimit: number;
  testedAt: string | null;
  passwordSet: boolean;
  tested: boolean;
  operational: boolean;
}

interface Template {
  key: string;
  label: string;
  audience: 'CLIENT' | 'STAFF';
  variables: string[];
  subject: string;
  body: string;
  text: string;
  isCustomized: boolean;
  updatedAt: string | null;
}

/** Libellé lisible d'un type d'e-mail de la file d'envoi. */
export function emailKindLabel(kind: string): string {
  const base: Record<string, string> = {
    INVOICE: 'Facture',
    INVOICE_CANCELLED: 'Facture annulée',
    CREDIT_NOTE: 'Avoir',
    PAYMENT_RECEIPT: 'Reçu de règlement',
    STATEMENT: 'Relevé de compte',
    DUNNING: 'Relance',
    PURCHASE_ORDER: 'Bon de commande',
    TEST: 'E-mail de test',
  };
  if (base[kind]) return base[kind];
  if (kind.startsWith('NOTIFICATION:')) {
    const [, event, burst] = kind.split(':');
    const label = NOTIFIABLE_EVENTS[event as keyof typeof NOTIFIABLE_EVENTS]?.label ?? event;
    return `Notification — ${label}${burst ? ' (récapitulatif)' : ''}`;
  }
  return kind;
}

/** Administration → E-mail & notifications (§6.19 A et D). */
export function EmailSettingsPage() {
  return (
    <>
      <PageHeader
        title="E-mail & notifications"
        description="Tout l’envoi d’e-mails reste désactivé tant que le serveur SMTP n’est pas configuré, activé et testé. Une panne e-mail ne bloque jamais une vente."
      />
      <Tabs defaultValue="smtp">
        <TabsList>
          <TabsTrigger value="smtp">Serveur SMTP</TabsTrigger>
          <TabsTrigger value="templates">Modèles d’e-mails</TabsTrigger>
        </TabsList>
        <TabsContent value="smtp">
          <SmtpCard />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesEditor />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SmtpCard() {
  const qc = useQueryClient();
  const fmt = useFormat();
  const config = useQuery({
    queryKey: ['email', 'smtp'],
    queryFn: () => api.get<SmtpConfig>('/email/smtp'),
  });
  const [form, setForm] = React.useState<SmtpConfig | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<'save' | 'test' | 'send' | null>(null);
  const [testTo, setTestTo] = React.useState('');
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  React.useEffect(() => {
    if (config.data) setForm(config.data);
  }, [config.data]);
  if (config.error)
    return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  if (!form || !config.data) return <Skeleton className="h-96" />;
  const set = <K extends keyof SmtpConfig>(k: K, v: SmtpConfig[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty =
    password !== null ||
    (
      [
        'enabled',
        'host',
        'port',
        'security',
        'username',
        'fromName',
        'fromEmail',
        'replyTo',
        'bccArchive',
        'hourlyLimit',
      ] as const
    ).some((k) => form[k] !== config.data![k]);

  const save = async () => {
    setBusy('save');
    setErrors({});
    try {
      await api.put('/email/smtp', {
        enabled: form.enabled,
        host: form.host,
        port: Number(form.port),
        security: form.security,
        username: form.username,
        ...(password !== null ? { password } : {}),
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        replyTo: form.replyTo,
        bccArchive: form.bccArchive,
        hourlyLimit: Number(form.hourlyLimit),
      });
      setPassword(null);
      toast.success('Configuration enregistrée. Testez la connexion pour activer l’envoi.');
      await qc.invalidateQueries({ queryKey: ['email'] });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const r = await api.post<{ message: string }>('/email/smtp/test-connection');
      setResult({ ok: true, message: r.message });
      await qc.invalidateQueries({ queryKey: ['email'] });
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  const sendTest = async () => {
    setBusy('send');
    setResult(null);
    try {
      await api.post('/email/smtp/test-send', { to: testTo });
      setResult({ ok: true, message: `E-mail de test envoyé à ${testTo}.` });
      await qc.invalidateQueries({ queryKey: ['email'] });
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Serveur d’envoi (SMTP)</CardTitle>
            <CardDescription>
              Hébergeur du domaine, Google Workspace / Gmail (mot de passe d’application), Microsoft
              365, service transactionnel…
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            {config.data.operational ? (
              <Badge variant="green">
                <CheckCircle2 className="size-3" /> Opérationnel
              </Badge>
            ) : (
              <Badge variant="orange">Envoi désactivé</Badge>
            )}
            {config.data.testedAt && (
              <span className="text-xs text-muted-foreground">
                Dernier test réussi : {fmt.dateTime(config.data.testedAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set('enabled', v)}
                aria-label="Envoi d’e-mails activé"
              />
              <span className="text-sm font-medium">Envoi d’e-mails activé</span>
            </label>
            <FormField label="Serveur (hôte)" error={errors.host} htmlFor="smtp-host">
              <Input
                id="smtp-host"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="smtp.exemple.tn"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Port" error={errors.port} htmlFor="smtp-port">
                <Input
                  id="smtp-port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => set('port', Number(e.target.value.replace(/\D/g, '')) || 0)}
                />
              </FormField>
              <FormField label="Sécurité" htmlFor="smtp-security">
                <NativeSelect
                  id="smtp-security"
                  value={form.security}
                  onChange={(e) => {
                    const security = e.target.value as SmtpConfig['security'];
                    set('security', security);
                    if (security === 'SSL' && form.port === 587) set('port', 465);
                    if (security === 'STARTTLS' && form.port === 465) set('port', 587);
                  }}
                >
                  <option value="SSL">SSL/TLS (465)</option>
                  <option value="STARTTLS">STARTTLS (587)</option>
                  <option value="NONE">Aucune</option>
                </NativeSelect>
              </FormField>
            </div>
            <FormField label="Identifiant" error={errors.username} htmlFor="smtp-user">
              <Input
                id="smtp-user"
                autoComplete="off"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
              />
            </FormField>
            <FormField
              label="Mot de passe"
              hint="Chiffré en base, jamais réaffiché."
              htmlFor="smtp-password"
            >
              {password === null ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="smtp-password"
                    disabled
                    value={config.data.passwordSet ? '••••••••••' : ''}
                    placeholder="Non défini"
                  />
                  <Button type="button" variant="outline" onClick={() => setPassword('')}>
                    <KeyRound /> Modifier
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id="smtp-password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nouveau mot de passe (vide = supprimer)"
                  />
                  <Button type="button" variant="ghost" onClick={() => setPassword(null)}>
                    Annuler
                  </Button>
                </div>
              )}
            </FormField>
            <FormField label="Nom de l’expéditeur" htmlFor="smtp-from-name">
              <Input
                id="smtp-from-name"
                value={form.fromName}
                onChange={(e) => set('fromName', e.target.value)}
                placeholder="Pharmacie…"
              />
            </FormField>
            <FormField label="Adresse de l’expéditeur" error={errors.fromEmail} htmlFor="smtp-from">
              <Input
                id="smtp-from"
                type="email"
                value={form.fromEmail}
                onChange={(e) => set('fromEmail', e.target.value)}
                placeholder="factures@domaine.tn"
              />
            </FormField>
            <FormField label="Adresse de réponse" error={errors.replyTo} htmlFor="smtp-reply">
              <Input
                id="smtp-reply"
                type="email"
                value={form.replyTo}
                onChange={(e) => set('replyTo', e.target.value)}
              />
            </FormField>
            <FormField
              label="Copie cachée d’archivage"
              error={errors.bccArchive}
              hint="Chaque e-mail client envoyé en copie à cette adresse."
              htmlFor="smtp-bcc"
            >
              <Input
                id="smtp-bcc"
                type="email"
                value={form.bccArchive}
                onChange={(e) => set('bccArchive', e.target.value)}
              />
            </FormField>
            <FormField
              label="Limite d’envois par heure"
              error={errors.hourlyLimit}
              htmlFor="smtp-limit"
            >
              <Input
                id="smtp-limit"
                inputMode="numeric"
                value={form.hourlyLimit}
                onChange={(e) => set('hourlyLimit', Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
            </FormField>
            <div className="flex items-end justify-end sm:col-span-2">
              <Button type="submit" loading={busy === 'save'} disabled={!dirty}>
                <Save /> Enregistrer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tests</CardTitle>
            <CardDescription>
              Une modification des paramètres de connexion exige un nouveau test avant tout envoi.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="outline"
              onClick={() => void test()}
              loading={busy === 'test'}
              disabled={dirty || !config.data.host}
            >
              <PlugZap /> Tester la connexion
            </Button>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="adresse@exemple.com"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                aria-label="Destinataire du test"
              />
              <Button
                variant="outline"
                onClick={() => void sendTest()}
                loading={busy === 'send'}
                disabled={dirty || !testTo.includes('@')}
              >
                <Send /> Envoyer
              </Button>
            </div>
            {dirty && (
              <p className="text-xs text-muted-foreground">
                Enregistrez d’abord vos modifications.
              </p>
            )}
            {result && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md p-2 text-sm',
                  result.ok
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                {result.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                {result.message}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <p>
              Envoi automatique des documents aux clients (facture, avoir, reçu…) :{' '}
              <Link to="/admin/settings" className="text-primary hover:underline">
                Paramètres › E-mails aux clients
              </Link>
              .
            </p>
            <p>
              Suivi des envois :{' '}
              <Link to="/admin/email-log" className="text-primary hover:underline">
                Journal des e-mails
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TemplatesEditor() {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<Template[]>('/email/templates'),
  });
  const [key, setKey] = React.useState<string>('INVOICE');
  const current = templates.data?.find((t) => t.key === key);
  const [draft, setDraft] = React.useState<{ subject: string; body: string; text: string } | null>(
    null,
  );
  const [preview, setPreview] = React.useState<{
    subject: string;
    html: string;
    text: string;
  } | null>(null);
  const [busy, setBusy] = React.useState<'save' | 'reset' | 'preview' | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (current) {
      setDraft({ subject: current.subject, body: current.body, text: current.text });
      setPreview(null);
    }
  }, [current]);

  if (templates.error)
    return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />;
  if (!templates.data || !current || !draft) return <Skeleton className="h-96" />;
  const dirty =
    draft.subject !== current.subject || draft.body !== current.body || draft.text !== current.text;

  const runPreview = async () => {
    setBusy('preview');
    try {
      setPreview(await api.post(`/email/templates/${key}/preview`, draft));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      await api.put(`/email/templates/${key}`, draft);
      toast.success('Modèle enregistré (tracé au mouchard).');
      await qc.invalidateQueries({ queryKey: ['email', 'templates'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy('reset');
    try {
      await api.post(`/email/templates/${key}/reset`);
      toast.success('Modèle par défaut restauré.');
      await qc.invalidateQueries({ queryKey: ['email', 'templates'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const insert = (variable: string) => {
    const token = `{{${variable}}}`;
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    setDraft({ ...draft, body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card className="h-fit">
        <ul className="flex flex-col p-1">
          {templates.data.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => setKey(t.key)}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                  t.key === key && 'bg-muted font-medium',
                )}
              >
                <span>{t.label}</span>
                {t.isCustomized && <Badge variant="blue">modifié</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>{current.label}</CardTitle>
              <CardDescription>
                {current.audience === 'CLIENT'
                  ? 'Destiné aux clients : ne jamais citer de nom de médicament (le détail est dans le PDF joint).'
                  : 'Destiné à l’équipe (notifications).'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runPreview()}
                loading={busy === 'preview'}
              >
                <Eye /> Aperçu
              </Button>
              {current.isCustomized && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void reset()}
                  loading={busy === 'reset'}
                >
                  <RotateCcw /> Restaurer le modèle par défaut
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void save()}
                loading={busy === 'save'}
                disabled={!dirty}
              >
                <Save /> Enregistrer
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <FormField label="Objet" htmlFor="tpl-subject">
              <Input
                id="tpl-subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </FormField>
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">Insérer :</span>
              {current.variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insert(v)}
                  className="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary/10"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <FormField label="Corps (MJML — rendu HTML responsive)" htmlFor="tpl-body">
              <Textarea
                id="tpl-body"
                ref={bodyRef}
                rows={10}
                className="font-mono text-xs"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </FormField>
            <FormField label="Version texte brut" htmlFor="tpl-text">
              <Textarea
                id="tpl-text"
                rows={6}
                className="font-mono text-xs"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </FormField>
          </CardContent>
        </Card>
        {preview && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-4" /> {preview.subject}
              </CardTitle>
              <CardDescription>Aperçu avec des données d’exemple.</CardDescription>
            </CardHeader>
            <CardContent>
              <iframe
                title="Aperçu de l’e-mail"
                sandbox=""
                srcDoc={preview.html}
                className="h-[32rem] w-full rounded-md border bg-white"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

interface OutboxRow {
  id: string;
  kind: string;
  to: string[];
  cc: string[];
  subject: string | null;
  status: keyof typeof EMAIL_STATUS;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  nextAttemptAt: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  documentNumber: string | null;
}

/** Journal des e-mails (§6.19 E) : statut, tentatives, dernière erreur, renvoi et annulation. */
export function EmailLogPage() {
  const fmt = useFormat();
  const can = useCan();
  const state = useTableState();
  const filters = { status: state.filter('status'), kind: state.filter('kind') };
  const list = useQuery({
    queryKey: ['email', 'log', state.page, state.pageSize, state.q, filters],
    queryFn: () =>
      api.get<Paginated<OutboxRow>>('/email/log', {
        query: { page: state.page, pageSize: state.pageSize, q: state.q, ...filters },
      }),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  });
  const act = async (row: OutboxRow, action: 'resend' | 'cancel') => {
    try {
      await api.post(`/email/log/${row.id}/${action}`);
      toast.success(action === 'resend' ? 'E-mail remis en file d’envoi.' : 'Envoi annulé.');
      void list.refetch();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const columns: Column<OutboxRow>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="tabular">
          {fmt.dateTime(row.original.sentAt ?? row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'to',
      header: 'Destinataire',
      cell: ({ row }) => <span className="text-xs">{row.original.to.join(', ')}</span>,
    },
    { id: 'kind', header: 'Type', cell: ({ row }) => emailKindLabel(row.original.kind) },
    {
      id: 'document',
      header: 'Document',
      cell: ({ row }) =>
        row.original.relatedEntityType === 'sale' && row.original.relatedEntityId ? (
          <Link
            to={`/sales/${row.original.relatedEntityId}`}
            className="font-mono text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.documentNumber ?? 'Vente'}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Statut',
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Badge variant={EMAIL_STATUS[row.original.status].variant}>
            {EMAIL_STATUS[row.original.status].label}
          </Badge>
          {row.original.status === 'QUEUED' && row.original.attempts > 0 && (
            <span className="text-[11px] text-muted-foreground">
              nouvel essai {fmt.time(row.original.nextAttemptAt)}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'attempts',
      header: 'Tentatives',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.attempts,
    },
    {
      id: 'error',
      header: 'Dernière erreur',
      cell: ({ row }) => (
        <span
          className="line-clamp-2 max-w-72 text-xs text-destructive"
          title={row.original.lastError ?? ''}
        >
          {row.original.lastError}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        can('email.view_log') && (
          <div className="flex justify-end gap-1">
            {(row.original.status === 'FAILED' ||
              row.original.status === 'SENT' ||
              row.original.status === 'CANCELLED') && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  void act(row.original, 'resend');
                }}
              >
                Renvoyer
              </Button>
            )}
            {row.original.status === 'QUEUED' && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  void act(row.original, 'cancel');
                }}
              >
                Annuler l’envoi
              </Button>
            )}
          </div>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Journal des e-mails"
        description="File d’envoi : reprises automatiques après 1 min, 5 min, 15 min, 1 h et 6 h, puis échec."
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        state={state}
        searchPlaceholder="Destinataire, objet…"
        toolbar={
          <>
            <NativeSelect
              className="w-40"
              value={filters.status}
              onChange={(e) => state.update({ status: e.target.value })}
              aria-label="Statut"
            >
              <option value="">Tous statuts</option>
              {Object.entries(EMAIL_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={filters.kind}
              onChange={(e) => state.update({ kind: e.target.value })}
              aria-label="Type"
            >
              <option value="">Tous types</option>
              {[
                'INVOICE',
                'INVOICE_CANCELLED',
                'CREDIT_NOTE',
                'PAYMENT_RECEIPT',
                'STATEMENT',
                'DUNNING',
              ].map((k) => (
                <option key={k} value={k}>
                  {emailKindLabel(k)}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
    </>
  );
}
