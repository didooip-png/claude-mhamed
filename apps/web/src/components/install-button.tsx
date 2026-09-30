import { Download, EllipsisVertical, PlusSquare, Share, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useInstall, type InstallPlatform } from '@/lib/install';
import { cn } from '@/lib/utils';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="min-w-0 pt-0.5 text-sm">{children}</span>
    </li>
  );
}

function InstallSteps({ platform }: { platform: InstallPlatform }) {
  if (platform === 'ios') {
    return (
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          Touchez le bouton <strong>Partager</strong>{' '}
          <Share className="inline size-4 align-text-bottom" aria-label="Partager" /> (Safari : en
          bas de l’écran ; Chrome : en haut à droite).
        </Step>
        <Step n={2}>
          Faites défiler le menu et touchez{' '}
          <strong>
            « Sur l’écran d’accueil »{' '}
            <PlusSquare className="inline size-4 align-text-bottom" aria-hidden />
          </strong>
          .
        </Step>
        <Step n={3}>
          Touchez <strong>Ajouter</strong>. L’icône PharmaStock apparaît sur votre écran d’accueil
          et s’ouvre en plein écran, comme une application.
        </Step>
      </ol>
    );
  }
  if (platform === 'android') {
    return (
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          Touchez le menu (trois points){' '}
          <EllipsisVertical className="inline size-4 align-text-bottom" aria-hidden /> en haut à
          droite de Chrome.
        </Step>
        <Step n={2}>
          Touchez <strong>« Installer l’application »</strong> (ou « Ajouter à l’écran d’accueil »).
        </Step>
        <Step n={3}>
          Confirmez avec <strong>Installer</strong>. L’icône PharmaStock apparaît parmi vos
          applications, sans passer par un magasin d’applications.
        </Step>
      </ol>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      <Step n={1}>
        Dans la barre d’adresse de Chrome ou Edge, cliquez sur l’icône{' '}
        <Download className="inline size-4 align-text-bottom" aria-hidden /> « Installer ».
      </Step>
      <Step n={2}>Confirmez : PharmaStock s’ouvre dans sa propre fenêtre.</Step>
    </ol>
  );
}

export function InstallDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: InstallPlatform;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Installer PharmaStock</DialogTitle>
          <DialogDescription>
            Ajoutez l’application à votre écran d’accueil : accès en un geste, plein écran, sans
            télécharger quoi que ce soit dans un magasin d’applications.
          </DialogDescription>
        </DialogHeader>
        <InstallSteps platform={platform} />
        {platform === 'ios' && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Sur iPhone, utilisez Safari (ou Chrome depuis iOS 17). Le mode navigation privée
            n’autorise pas l’installation.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bouton « Installer » : fenêtre native quand le navigateur la propose (Android, Chrome/Edge PC),
 * sinon explications pas à pas (iPhone, Android sans événement). Invisible une fois installée.
 */
export function InstallButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { mode, platform, install } = useInstall();
  const [help, setHelp] = React.useState(false);
  if (mode === 'hidden') return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-1.5 border-primary/40 text-primary', className)}
        onClick={async () => {
          if (mode === 'prompt') {
            const accepted = await install();
            if (accepted) toast.success('PharmaStock est installée sur cet appareil.');
          } else {
            setHelp(true);
          }
        }}
      >
        <Download />
        <span className={cn(compact && 'sr-only sm:not-sr-only')}>Installer</span>
      </Button>
      <InstallDialog open={help} onOpenChange={setHelp} platform={platform} />
    </>
  );
}

const DISMISS_KEY = 'pharmastock.install-banner';
const DISMISS_DAYS = 14;

/** Bandeau discret en bas de l'écran sur téléphone : rappelle qu'on peut installer l'application. */
export function InstallBanner() {
  const { mode, platform, install } = useInstall();
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) ?? '0');
      return Date.now() < until;
    } catch {
      return false;
    }
  });
  const [help, setHelp] = React.useState(false);
  if (mode === 'hidden' || dismissed || platform === 'desktop') return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
    } catch {
      /* stockage indisponible : le bandeau reviendra, sans gravité */
    }
  };
  return (
    <>
      <div
        role="region"
        aria-label="Installer l’application"
        className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border bg-card p-3 shadow-lg lg:hidden print:hidden"
      >
        <img src="/icon.svg" alt="" className="size-10 shrink-0" />
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <div className="font-medium">Installer PharmaStock</div>
          <div className="text-xs text-muted-foreground">
            Sur votre écran d’accueil, sans magasin d’applications.
          </div>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            if (mode === 'prompt') {
              if (await install()) {
                toast.success('PharmaStock est installée sur cet appareil.');
                dismiss();
              }
            } else {
              setHelp(true);
            }
          }}
        >
          Installer
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="-mr-1 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="Plus tard"
        >
          <X className="size-4" />
        </button>
      </div>
      <InstallDialog open={help} onOpenChange={setHelp} platform={platform} />
    </>
  );
}
