import {
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationMode,
  type NotificationSchedule,
  type NotificationThresholds,
} from '@pharmastock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Loader2, RotateCcw, Save, Users } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField, MoneyInput, PercentInput } from '@/components/form';
import { ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';

interface EventPref {
  eventType: string;
  group: NotificationGroup;
  label: string;
  critical: boolean;
  employee: boolean;
  threshold: 'amount' | 'discount' | null;
  digestOnly: boolean;
  allowedModes: NotificationMode[];
  defaultMode: NotificationMode;
  mode: NotificationMode;
  isCustom: boolean;
  watchedUserIds: string[];
  thresholds: NotificationThresholds;
  outsideHoursOnly: boolean;
  schedule: Required<NotificationSchedule>;
}

interface Preferences {
  accountEmail: string | null;
  notificationEmail: string | null;
  smtpOperational: boolean;
  events: EventPref[];
}

const MODE_LABEL: Record<NotificationMode, string> = {
  OFF: 'Désactivé',
  IN_APP: 'Dans le logiciel uniquement',
  EMAIL_IMMEDIATE: 'E-mail immédiat',
  EMAIL_DAILY: 'Résumé quotidien',
  EMAIL_WEEKLY: 'Résumé hebdomadaire',
};

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const time = (s: { hour: number; minute: number }) =>
  `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
const parseTime = (v: string) => {
  const [h = '20', m = '0'] = v.split(':');
  return { hour: Math.min(23, Number(h) || 0), minute: Math.min(59, Number(m) || 0) };
};

const signature = (e: EventPref) =>
  JSON.stringify([e.mode, e.watchedUserIds, e.thresholds, e.outsideHoursOnly, e.schedule]);

function WatchedUsers({
  value,
  users,
  onChange,
}: {
  value: string[];
  users: { id: string; code: string; fullName: string }[];
  onChange: (ids: string[]) => void;
}) {
  const label =
    value.length === 0
      ? 'Tous les employés'
      : users
          .filter((u) => value.includes(u.id))
          .map((u) => u.code)
          .join(', ');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 justify-start truncate">
          <Users /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="mb-2 text-xs text-muted-foreground">
          Ne rien cocher = tous les employés. Cochez pour ne suivre que certains employés.
        </p>
        <div className="max-h-60 overflow-auto">
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 px-1 py-1 text-sm">
              <Checkbox
                checked={value.includes(u.id)}
                onCheckedChange={(c) =>
                  onChange(c === true ? [...value, u.id] : value.filter((i) => i !== u.id))
                }
              />
              <span className="font-mono text-xs">{u.code}</span> {u.fullName}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Page « Mes notifications » (§6.19 B) : mode, employés suivis, seuils et heures des résumés. */
export function MyNotificationsPage() {
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<Preferences>('/notifications/preferences'),
  });
  const users = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => api.get<{ id: string; code: string; fullName: string }[]>('/users/directory'),
    staleTime: 60_000,
  });
  const [draft, setDraft] = React.useState<EventPref[] | null>(null);
  const [email, setEmail] = React.useState('');
  const [daily, setDaily] = React.useState({ hour: 20, minute: 0 });
  const [weekly, setWeekly] = React.useState({ weekday: 0, hour: 20, minute: 0 });
  const [activity, setActivity] = React.useState({ hour: 20, minute: 0 });

  const load = React.useCallback((p: Preferences) => {
    setDraft(p.events);
    setEmail(p.notificationEmail ?? '');
    const firstDaily = p.events.find(
      (e) => e.mode === 'EMAIL_DAILY' && e.eventType !== 'ACTIVITY_REPORT',
    );
    const firstWeekly = p.events.find((e) => e.mode === 'EMAIL_WEEKLY');
    const report = p.events.find((e) => e.eventType === 'ACTIVITY_REPORT');
    if (firstDaily)
      setDaily({ hour: firstDaily.schedule.hour, minute: firstDaily.schedule.minute });
    if (firstWeekly)
      setWeekly({
        weekday: firstWeekly.schedule.weekday,
        hour: firstWeekly.schedule.hour,
        minute: firstWeekly.schedule.minute,
      });
    if (report) setActivity({ hour: report.schedule.hour, minute: report.schedule.minute });
  }, []);
  React.useEffect(() => {
    if (prefs.data) load(prefs.data);
  }, [prefs.data, load]);

  const scheduleFor = (e: EventPref): Required<NotificationSchedule> =>
    e.eventType === 'ACTIVITY_REPORT'
      ? { ...activity, weekday: 0 }
      : e.mode === 'EMAIL_WEEKLY'
        ? weekly
        : e.mode === 'EMAIL_DAILY'
          ? { ...daily, weekday: 0 }
          : e.schedule;

  const save = useMutation({
    mutationFn: () => {
      const original = new Map(prefs.data!.events.map((e) => [e.eventType, e]));
      const subscriptions = draft!
        .map((e) => ({ ...e, schedule: scheduleFor(e) }))
        .filter((e) => e.isCustom || signature(e) !== signature(original.get(e.eventType)!))
        .map((e) => ({
          eventType: e.eventType,
          mode: e.mode,
          watchedUserIds: e.watchedUserIds,
          thresholds: e.thresholds,
          outsideHoursOnly: e.outsideHoursOnly,
          schedule: e.schedule,
        }));
      return api.put<Preferences>('/notifications/preferences', {
        notificationEmail: email.trim(),
        subscriptions,
      });
    },
    onSuccess: (res) => {
      toast.success('Notifications enregistrées');
      qc.setQueryData(['notifications', 'preferences'], res);
      load(res);
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const reset = useMutation({
    mutationFn: () => api.post<Preferences>('/notifications/preferences/reset'),
    onSuccess: (res) => {
      toast.success('Valeurs par défaut rétablies');
      qc.setQueryData(['notifications', 'preferences'], res);
      load(res);
    },
    onError: (err) => toast.error(errorText(err)),
  });

  if (prefs.error) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />;
  if (!prefs.data || !draft) return <Skeleton className="h-96" />;

  const patch = (eventType: string, change: Partial<EventPref>) =>
    setDraft((prev) => prev!.map((e) => (e.eventType === eventType ? { ...e, ...change } : e)));
  const hasDaily = draft.some((e) => e.mode === 'EMAIL_DAILY' && e.eventType !== 'ACTIVITY_REPORT');
  const hasWeekly = draft.some((e) => e.mode === 'EMAIL_WEEKLY');
  const reportEvent = draft.find((e) => e.eventType === 'ACTIVITY_REPORT');
  const groups = Object.keys(NOTIFICATION_GROUPS) as NotificationGroup[];
  const emailModes = (e: EventPref) => e.mode.startsWith('EMAIL');
  const needsEmail = draft.some(emailModes) && !email.trim() && !prefs.data.accountEmail;

  return (
    <>
      <PageHeader
        title="Mes notifications"
        description="Choisissez de quoi vous êtes prévenu, et comment. Les préparateurs ne reçoivent jamais l’activité des autres employés."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm('Rétablir toutes les valeurs par défaut ?')) reset.mutate();
              }}
              disabled={reset.isPending}
            >
              <RotateCcw /> Valeurs par défaut
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
            </Button>
          </>
        }
      />
      {!prefs.data.smtpOperational && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Le serveur e-mail n’est pas configuré et testé : seules les notifications dans le
            logiciel (cloche) fonctionnent pour l’instant.
          </span>
        </div>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Adresse de réception</CardTitle>
            <CardDescription>
              Compte : {prefs.data.accountEmail ?? 'aucune adresse'}. Laissez vide pour utiliser
              l’adresse du compte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField label="Adresse e-mail des notifications">
              <Input
                type="email"
                value={email}
                placeholder="patron@pharmacie.tn"
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            {needsEmail && (
              <p className="mt-2 text-xs text-destructive">
                Aucune adresse : les e-mails ne pourront pas vous être envoyés.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Heures d’envoi des résumés</CardTitle>
            <CardDescription>
              Un résumé regroupe les événements de la période ; rien n’est envoyé s’il n’y en a pas.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <FormField label="Résumé quotidien">
              <Input
                type="time"
                value={time(daily)}
                disabled={!hasDaily}
                onChange={(e) => setDaily(parseTime(e.target.value))}
              />
            </FormField>
            <FormField label="Résumé hebdomadaire">
              <div className="flex gap-1">
                <NativeSelect
                  value={weekly.weekday}
                  disabled={!hasWeekly}
                  onChange={(e) => setWeekly({ ...weekly, weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  type="time"
                  className="w-36"
                  value={time(weekly)}
                  disabled={!hasWeekly}
                  onChange={(e) => setWeekly({ ...weekly, ...parseTime(e.target.value) })}
                />
              </div>
            </FormField>
            <FormField
              label="Rapport d’activité"
              hint={activity.hour < 12 ? 'Rapport de la veille' : 'Rapport du jour'}
            >
              <Input
                type="time"
                value={time(activity)}
                disabled={reportEvent?.mode !== 'EMAIL_DAILY'}
                onChange={(e) => setActivity(parseTime(e.target.value))}
              />
            </FormField>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const rows = draft.filter((e) => e.group === group);
          if (rows.length === 0) return null;
          return (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="size-4" /> {NOTIFICATION_GROUPS[group]}
                </CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Événement</TH>
                    <TH className="w-80">Mode</TH>
                    <TH>Filtres</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((e) => (
                    <TR key={e.eventType}>
                      <TD>
                        <div className="font-medium">{e.label}</div>
                        <div className="mt-0.5 flex gap-1">
                          {e.critical && <Badge variant="red">Alerte critique</Badge>}
                          {e.isCustom && <Badge variant="blue">Personnalisé</Badge>}
                        </div>
                      </TD>
                      <TD>
                        <NativeSelect
                          value={e.mode}
                          aria-label={`Mode — ${e.label}`}
                          onChange={(ev) =>
                            patch(e.eventType, { mode: ev.target.value as NotificationMode })
                          }
                        >
                          {e.allowedModes.map((m) => (
                            <option key={m} value={m}>
                              {MODE_LABEL[m]}
                              {m === e.defaultMode ? ' (défaut)' : ''}
                            </option>
                          ))}
                        </NativeSelect>
                      </TD>
                      <TD>
                        {e.mode === 'OFF' ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {e.employee && (
                              <WatchedUsers
                                value={e.watchedUserIds}
                                users={users.data ?? []}
                                onChange={(ids) => patch(e.eventType, { watchedUserIds: ids })}
                              />
                            )}
                            {e.threshold === 'amount' && (
                              <div className="flex items-center gap-1 text-xs">
                                <span className="text-muted-foreground">dès</span>
                                <div className="w-28">
                                  <MoneyInput
                                    value={e.thresholds.minAmount ?? null}
                                    placeholder="0,000"
                                    onValueChange={(v) =>
                                      patch(e.eventType, {
                                        thresholds: { ...e.thresholds, minAmount: v ?? undefined },
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            )}
                            {e.threshold === 'discount' && (
                              <div className="flex items-center gap-1 text-xs">
                                <span className="text-muted-foreground">dès</span>
                                <div className="w-24">
                                  <PercentInput
                                    value={e.thresholds.minDiscountBp ?? 0}
                                    onValueChange={(bp) =>
                                      patch(e.eventType, {
                                        thresholds: {
                                          ...e.thresholds,
                                          minDiscountBp: bp || undefined,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            )}
                            {e.employee && (
                              <label className="flex items-center gap-1.5 text-xs">
                                <Checkbox
                                  checked={e.outsideHoursOnly}
                                  onCheckedChange={(c) =>
                                    patch(e.eventType, { outsideHoursOnly: c === true })
                                  }
                                />
                                Hors horaires d’ouverture seulement
                              </label>
                            )}
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
