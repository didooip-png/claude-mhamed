import { Command as Cmdk } from 'cmdk';
import {
  Boxes,
  ChevronDown,
  Home,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  Monitor,
  Printer,
  Moon,
  Receipt,
  Search,
  ShoppingCart,
  Sun,
  UserRound,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Label } from '@/components/ui/input';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { api, connection, errorText } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { GuidedTour } from '@/components/help/guided-tour';
import { HelpButton } from '@/components/help/help-panel';
import { InstallBanner, InstallButton } from '@/components/install-button';
import { platform } from '@/lib/platform';
import { OverrideDialogHost } from '@/components/override-dialog';
import { NotificationBell } from '@/pages/notifications/notifications';
import { AVAILABLE_ROUTES, NAV, type NavItem } from './nav';

function useVisibleNav(): NavItem[] {
  const me = useMe();
  const can = (anyOf?: string[]) =>
    !anyOf || anyOf.some((p) => me.permissions.includes(p as never));
  return NAV.filter((item) => can(item.anyOf))
    .map((item) => ({
      ...item,
      children: item.children?.filter((c) => can(c.anyOf) && AVAILABLE_ROUTES.has(c.to)),
    }))
    .filter((item) => (item.children ? item.children.length > 0 : AVAILABLE_ROUTES.has(item.to)));
}

/** Repères de la visite guidée (`data-tour`) posés sur certaines entrées du menu. */
const TOUR_IDS: Record<string, string> = {
  '/pos': 'nav-pos',
  '/admin': 'nav-admin',
  '/reports': 'nav-reports',
};

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const items = useVisibleNav();
  const location = useLocation();
  const settings = useSettings();
  return (
    <nav
      className="flex h-full flex-col gap-1 overflow-y-auto p-2"
      aria-label="Navigation principale"
      data-tour="nav"
    >
      <div className="mb-2 flex items-center gap-2 px-2 py-2">
        <img src="/icon.svg" alt="" className="size-7" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">PharmaStock</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {settings['establishment.name']}
          </div>
        </div>
      </div>
      {items.map((item) => {
        const Icon = item.icon;
        if (!item.children) {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              data-tour={TOUR_IDS[item.to]}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                  isActive && 'bg-accent text-accent-foreground hover:bg-accent',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.shortcut && <Kbd className="ml-auto">{item.shortcut}</Kbd>}
            </NavLink>
          );
        }
        const open = item.children.some(
          (c) => location.pathname === c.to || location.pathname.startsWith(`${c.to}/`),
        );
        return (
          <details key={item.label} open={open} className="group">
            <summary
              data-tour={TOUR_IDS[item.to]}
              className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground select-none hover:bg-muted hover:text-foreground"
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l pl-2">
              {item.children.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  end
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground',
                      isActive && 'bg-accent font-medium text-accent-foreground hover:bg-accent',
                    )
                  }
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}

/** Palette de commandes (Ctrl+K) : navigation et recherche globale. */
function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const items = useVisibleNav();
  const entries = items.flatMap((i) =>
    i.children
      ? i.children.map((c) => ({ label: `${i.label} › ${c.label}`, to: c.to }))
      : [{ label: i.label, to: i.to }],
  );
  const extra = React.useContext(CommandExtensionContext);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="gap-0 overflow-hidden p-0"
        hideClose
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Recherche globale</DialogTitle>
        <Cmdk label="Recherche globale" className="flex flex-col" loop>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <Cmdk.Input
              autoFocus
              placeholder="Aller à un écran, rechercher un produit, un client, un n° de document…"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <Cmdk.List className="max-h-96 overflow-y-auto p-2">
            <Cmdk.Empty className="py-6 text-center text-sm text-muted-foreground">
              Aucun résultat.
            </Cmdk.Empty>
            {extra}
            <Cmdk.Group
              heading="Écrans"
              className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {entries.map((e) => (
                <Cmdk.Item
                  key={e.to}
                  value={e.label}
                  onSelect={() => {
                    onOpenChange(false);
                    void navigate(e.to);
                  }}
                  className="flex cursor-pointer items-center rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                >
                  {e.label}
                </Cmdk.Item>
              ))}
            </Cmdk.Group>
          </Cmdk.List>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}

/** Permet aux modules métier d'ajouter des résultats (produits, clients, documents) à la palette. */
export const CommandExtensionContext = React.createContext<React.ReactNode>(null);

function SwitchUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { switchUser } = useAuth();
  const [code, setCode] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setCode('');
      setPin('');
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Changer d’utilisateur</DialogTitle>
          <DialogDescription>
            Saisissez votre code utilisateur et votre PIN. La session actuelle sera fermée.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await switchUser(code, pin);
              onOpenChange(false);
              toast.success('Utilisateur changé');
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sw-code">Code utilisateur</Label>
            <Input
              id="sw-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PRE01"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sw-pin">PIN</Label>
            <Input
              id="sw-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={!code || pin.length < 4}>
              Changer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionIndicator() {
  const { online } = connection.use();
  return (
    <Tooltip content={online ? 'Connecté au serveur' : 'Connexion perdue'}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-xs',
          online ? 'text-muted-foreground' : 'font-medium text-destructive',
        )}
      >
        <span className={cn('size-2 rounded-full', online ? 'bg-emerald-500' : 'bg-destructive')} />
        <span className="hidden lg:inline">{online ? 'En ligne' : 'Hors ligne'}</span>
      </span>
    </Tooltip>
  );
}

/** Bandeau « Connexion perdue » + sonde de reconnexion (§9). */
function ConnectionBanner() {
  const { online } = connection.use();
  React.useEffect(() => {
    if (online) return;
    const id = window.setInterval(() => {
      void api.get('/health', { background: true, noRefresh: true }).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [online]);
  if (online) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
    >
      <WifiOff className="size-4" />
      Connexion perdue — aucune opération ne peut être enregistrée. Reconnexion automatique en
      cours…
    </div>
  );
}

/** Verrouillage automatique après inactivité (appliqué aussi côté serveur). */
function useInactivityLock() {
  const { lock } = useAuth();
  const minutes = useSettings()['security.inactivity_lock_minutes'];
  React.useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = window.setInterval(() => {
      if (Date.now() - last > minutes * 60_000) void lock();
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(id);
    };
  }, [minutes, lock]);
}

/** Barre de navigation basse (téléphone) : accès direct aux écrans les plus utilisés. */
function BottomNav({ onMenu }: { onMenu: () => void }) {
  const me = useMe();
  const items = [
    { to: '/', label: 'Accueil', icon: Home, anyOf: undefined as string[] | undefined },
    { to: '/pos', label: 'Caisse', icon: ShoppingCart, anyOf: ['sales.create'] },
    { to: '/sales', label: 'Ventes', icon: Receipt, anyOf: ['sales.create', 'sales.view_all'] },
    { to: '/stock', label: 'Stock', icon: Boxes, anyOf: ['stock.view'] },
  ].filter(
    (i) =>
      (!i.anyOf || i.anyOf.some((p) => me.permissions.includes(p as never))) &&
      AVAILABLE_ROUTES.has(i.to),
  );
  const tab =
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground';
  return (
    <nav
      aria-label="Navigation rapide"
      data-tour="nav"
      className="flex shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            data-tour={item.to === '/pos' ? 'nav-pos' : undefined}
            className={({ isActive }) => cn(tab, isActive && 'text-primary')}
          >
            <Icon className="size-5" />
            {item.label}
          </NavLink>
        );
      })}
      <button type="button" onClick={onMenu} className={cn(tab, 'cursor-pointer')}>
        <Menu className="size-5" />
        Menu
      </button>
    </nav>
  );
}

export function AppShell() {
  const me = useMe();
  const { state, logout, lock } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [switchOpen, setSwitchOpen] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  useInactivityLock();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (
        e.key === 'F12' &&
        me.permissions.includes('sales.create') &&
        AVAILABLE_ROUTES.has('/pos')
      ) {
        e.preventDefault();
        void navigate('/pos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, me.permissions]);

  const deviceName = state.status === 'authenticated' ? state.deviceName : '';
  // L'écran de caisse occupe toute la hauteur disponible.
  const fullBleed = location.pathname === '/pos';

  return (
    <div className="flex h-dvh flex-col">
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block print:hidden">
          <Sidebar />
        </aside>
        {mobileNav && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
            <aside className="absolute inset-y-0 left-0 w-[85vw] max-w-80 border-r bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-lg">
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-2"
                onClick={() => setMobileNav(false)}
                aria-label="Fermer le menu"
              >
                <X />
              </Button>
              <Sidebar onNavigate={() => setMobileNav(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b bg-card px-3 pt-[env(safe-area-inset-top)] print:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Ouvrir le menu"
            >
              <Menu />
            </Button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-tour="search"
              aria-label="Rechercher"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-muted/50 text-muted-foreground hover:bg-muted sm:h-8 sm:w-full sm:max-w-md sm:justify-start sm:gap-2 sm:px-2.5 sm:text-sm"
            >
              <Search className="size-4" />
              <span className="hidden truncate sm:inline">Rechercher…</span>
              <Kbd className="ml-auto hidden sm:inline-flex">Ctrl K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <InstallButton />
              <ConnectionIndicator />
              <span data-tour="bell" className="inline-flex">
                <NotificationBell />
              </span>
              <HelpButton />
              <Tooltip content="Poste de travail courant">
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
                  <Monitor className="size-3.5" />
                  {deviceName}
                </span>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2" data-tour="user">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {me.code.slice(0, 3)}
                    </span>
                    <span className="hidden max-w-40 truncate sm:inline">{me.fullName}</span>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium text-foreground">{me.fullName}</div>
                    <div className="text-xs">
                      {me.code} · {me.role.name}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void navigate('/account')}>
                    <UserRound /> Mon compte
                  </DropdownMenuItem>
                  {platform.isDesktop && (
                    <DropdownMenuItem onSelect={() => void platform.openSettings()}>
                      <Printer /> Réglages du poste
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setSwitchOpen(true)}>
                    <Users /> Changer d’utilisateur (PIN)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void lock()}>
                    <Lock /> Verrouiller l’écran
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? <Sun /> : <Moon />} Mode{' '}
                    {theme === 'dark' ? 'clair' : 'sombre'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => void logout()}>
                    <LogOut /> Se déconnecter
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {fullBleed ? (
              <div className="h-full p-3">
                <Outlet />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-4 lg:p-6">
                <Outlet />
              </div>
            )}
          </main>
        </div>
      </div>
      {!fullBleed && <BottomNav onMenu={() => setMobileNav(true)} />}
      <InstallBanner />
      <GuidedTour />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SwitchUserDialog open={switchOpen} onOpenChange={setSwitchOpen} />
      <OverrideDialogHost />
    </div>
  );
}

/** Écran de verrouillage (inactivité ou verrouillage manuel) : PIN, ou code + PIN d'un collègue. */
export function LockScreen() {
  const { state, unlock, logout } = useAuth();
  const user = state.status === 'locked' ? state.user : null;
  const [pin, setPin] = React.useState('');
  const [otherCode, setOtherCode] = React.useState('');
  const [other, setOther] = React.useState(!user);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">Écran verrouillé</h1>
          <p className="text-sm text-muted-foreground">
            {user && !other ? (
              <>
                {user.fullName} ({user.code}) — saisissez votre PIN.
              </>
            ) : (
              'Saisissez votre code utilisateur et votre PIN.'
            )}
          </p>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              if (other) {
                await apiUnlockAs(otherCode, pin, unlock);
              } else {
                await unlock(pin);
              }
            } catch (err) {
              setError(errorText(err));
              setPin('');
            } finally {
              setBusy(false);
            }
          }}
        >
          {other && (
            <Input
              autoFocus
              placeholder="Code utilisateur (ex. PRE01)"
              value={otherCode}
              onChange={(e) => setOtherCode(e.target.value.toUpperCase())}
              aria-label="Code utilisateur"
            />
          )}
          <Input
            autoFocus={!other}
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="PIN"
            className="text-center text-lg tracking-[0.5em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-label="PIN"
          />
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          <Button type="submit" loading={busy} disabled={pin.length < 4 || (other && !otherCode)}>
            <KeyRound /> Déverrouiller
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-xs">
          {user && (
            <button
              type="button"
              className="cursor-pointer text-primary hover:underline"
              onClick={() => setOther((v) => !v)}
            >
              {other ? `Revenir à ${user.code}` : 'Autre utilisateur'}
            </button>
          )}
          <button
            type="button"
            className="ml-auto cursor-pointer text-muted-foreground hover:underline"
            onClick={() => void logout()}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

/** Déverrouillage par un autre utilisateur : ouvre une nouvelle session à son nom. */
async function apiUnlockAs(
  userCode: string,
  pin: string,
  unlock: (pin: string, userCode?: string) => Promise<void>,
) {
  await unlock(pin, userCode);
}
