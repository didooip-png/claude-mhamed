import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { AVAILABLE_ROUTES, NAV } from '@/components/layout/nav';
import { PageHeader } from '@/components/page';
import { Card, CardContent } from '@/components/ui/card';
import { useMe } from '@/lib/auth';
import { useSettings } from '@/lib/queries';

/** Tableau de bord (§6.1) — enrichi au fil des phases (CA, alertes, stock…). */
export function DashboardPage() {
  const me = useMe();
  const settings = useSettings();
  const shortcuts = NAV.flatMap((item) => {
    const can = (anyOf?: string[]) =>
      !anyOf || anyOf.some((p) => me.permissions.includes(p as never));
    if (!can(item.anyOf)) return [];
    const children = item.children?.filter((c) => can(c.anyOf) && AVAILABLE_ROUTES.has(c.to)) ?? [];
    const entries = item.children
      ? children.map((c) => ({ label: c.label, to: c.to, icon: item.icon, group: item.label }))
      : AVAILABLE_ROUTES.has(item.to) && item.to !== '/'
        ? [{ label: item.label, to: item.to, icon: item.icon, group: '' }]
        : [];
    return entries;
  });
  return (
    <>
      <PageHeader
        title={`Bonjour ${me.fullName.split(' ')[0]}`}
        description={`${settings['establishment.name']} — ${me.role.name} (${me.code})`}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.to} to={s.to}>
              <Card className="transition-colors hover:border-primary/40 hover:bg-accent/40">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {s.group && <div className="text-xs text-muted-foreground">{s.group}</div>}
                    <div className="truncate font-medium">{s.label}</div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
