import { TOUR_STEPS, type TourStep } from '@pharmastock/shared';
import * as React from 'react';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/auth';
import { markTourSeen, tourSeen, useHelpEvent, useHelpRole } from '@/lib/help';
import { useIsMobile } from '@/lib/media';

const PAD = 6;
const GAP = 12;

/** Premier élément visible portant `data-tour="…"` (le menu existe en double bureau / téléphone). */
function findTarget(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Visite guidée : projecteur sur l'élément décrit + carte explicative. Lancée automatiquement au
 * premier passage sur le tableau de bord (une fois par utilisateur), relançable depuis l'aide.
 */
export function GuidedTour() {
  const me = useMe();
  const role = useHelpRole();
  const { pathname } = useLocation();
  const mobile = useIsMobile();
  const [steps, setSteps] = React.useState<TourStep[] | null>(null);
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [cardSize, setCardSize] = React.useState({ w: 340, h: 200 });
  const card = React.useRef<HTMLDivElement>(null);
  const autoStarted = React.useRef(false);

  const start = React.useCallback(() => {
    // Les étapes dont l'élément n'existe pas sur cet appareil ou pour ce rôle sont sautées.
    const active = TOUR_STEPS.filter(
      (s) => (!s.roles || s.roles.includes(role)) && (!s.target || findTarget(s.target)),
    );
    setIndex(0);
    setSteps(active);
  }, [role]);

  useHelpEvent('tour', start);

  React.useEffect(() => {
    if (autoStarted.current || pathname !== '/' || tourSeen(me.id)) return;
    // Le garde est posé au déclenchement (et non à la planification) : en développement React
    // exécute chaque effet deux fois et annulerait sinon la seule échéance planifiée.
    const timer = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      start();
    }, 900);
    return () => clearTimeout(timer);
  }, [pathname, me.id, start]);

  const close = React.useCallback(() => {
    markTourSeen(me.id);
    setSteps(null);
  }, [me.id]);

  const step = steps?.[index];

  const measure = React.useCallback(() => {
    if (!step?.target) return setRect(null);
    const el = findTarget(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  React.useLayoutEffect(() => {
    if (!step) return;
    if (step.target)
      findTarget(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, measure]);

  // La carte change de taille avec le texte de chaque étape : on la remesure pour la placer.
  React.useLayoutEffect(() => {
    const el = card.current;
    if (el) setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [index, steps, mobile]);

  React.useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps, close]);

  if (!steps || !step) return null;
  const last = index === steps.length - 1;

  let cardStyle: React.CSSProperties;
  if (mobile) {
    // Téléphone : carte collée en haut ou en bas, du côté opposé à l'élément mis en évidence.
    const atBottom = rect ? rect.top < window.innerHeight / 2 : true;
    cardStyle = atBottom
      ? { left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))' }
      : { left: 12, right: 12, top: 'calc(12px + env(safe-area-inset-top))' };
  } else if (!rect) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: cardSize.w };
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tall = rect.height > vh * 0.5;
    if (tall && rect.right + GAP + cardSize.w + 12 < vw) {
      cardStyle = {
        left: rect.right + PAD + GAP,
        top: clamp(rect.top + 60, 12, vh - cardSize.h - 12),
      };
    } else if (rect.bottom + PAD + GAP + cardSize.h + 12 < vh) {
      cardStyle = {
        left: clamp(rect.left, 12, vw - cardSize.w - 12),
        top: rect.bottom + PAD + GAP,
      };
    } else {
      cardStyle = {
        left: clamp(rect.left, 12, vw - cardSize.w - 12),
        top: clamp(rect.top - PAD - GAP - cardSize.h, 12, vh - cardSize.h - 12),
      };
    }
  }

  return (
    <div className="fixed inset-0 z-[70] print:hidden" data-testid="guided-tour">
      {/* Bloque les clics sur la page pendant la visite. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-card p-4 shadow-xl max-sm:w-auto"
        style={cardStyle}
      >
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Étape {index + 1} sur {steps.length}
          </span>
          <button type="button" onClick={close} className="cursor-pointer underline">
            Passer la visite
          </button>
        </div>
        <h2 id="tour-title" className="text-base font-semibold">
          {step.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${i === index ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
                Précédent
              </Button>
            )}
            <Button
              size="sm"
              autoFocus
              onClick={() => (last ? close() : setIndex(index + 1))}
              data-testid="tour-next"
            >
              {last ? 'Terminer' : 'Suivant'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
