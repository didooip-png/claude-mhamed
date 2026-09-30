import { faqForTopic, topicForPath } from '@pharmastock/shared';
import { BookOpen, CircleHelp, Compass } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { FaqItem, TopicView } from '@/components/help/help-content';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/misc';
import { startTour, useHelpEvent, useHelpRole } from '@/lib/help';

/** Bouton « ? » de l'en-tête et panneau d'aide de l'écran affiché (touche F1 hors caisse). */
export function HelpButton() {
  const [open, setOpen] = React.useState(false);
  const { pathname } = useLocation();
  useHelpEvent('open', () => setOpen(true));

  React.useEffect(() => {
    // La caisse a son propre F1 (raccourcis de la caisse) ; ailleurs F1 ouvre l'aide de l'écran.
    if (pathname === '/pos') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname]);

  return (
    <>
      <Tooltip content="Aide sur cet écran (F1)" side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          data-tour="help"
          aria-label="Aide sur cet écran"
          onClick={() => setOpen(true)}
        >
          <CircleHelp />
        </Button>
      </Tooltip>
      <HelpPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

function HelpPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pathname } = useLocation();
  const role = useHelpRole();
  const topic = topicForPath(pathname, role);
  const related = topic ? faqForTopic(topic, role) : [];
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) scroller.current?.scrollTo({ top: 0 });
  }, [open, pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="help-panel">
        <div className="border-b px-4 py-3 pr-10">
          <SheetTitle className="text-base font-semibold">
            {topic ? topic.title : 'Aide'}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {topic ? 'Comment utiliser cet écran' : 'Aucune fiche pour cet écran'}
          </SheetDescription>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {topic ? (
            <TopicView topic={topic} role={role} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Cet écran n’a pas de fiche d’aide propre. La page Aide regroupe toutes les procédures,
              la FAQ « Que faire si… » et la fiche mémo.
            </p>
          )}
          {related.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Que faire si…
              </h3>
              {related.map((f) => (
                <FaqItem key={f.id} entry={f} />
              ))}
            </section>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
            <Link to="/help">
              <BookOpen /> Toute l’aide
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              startTour();
            }}
          >
            <Compass /> Visite guidée
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
