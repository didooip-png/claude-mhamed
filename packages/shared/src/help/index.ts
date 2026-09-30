import { HELP_CHAPTERS } from './chapters.js';
import { TOPICS_ADMIN } from './topics-admin.js';
import { TOPICS_DAILY } from './topics-daily.js';
import { TOPICS_STOCK } from './topics-stock.js';
import { FAQ } from './faq.js';
import type { FaqEntry, HelpChapter, HelpRole, HelpTopic } from './types.js';

export * from './chapters.js';
export * from './faq.js';
export * from './memo.js';
export * from './tour.js';
export * from './types.js';

/** Toutes les fiches d’aide, dans l’ordre du manuel. */
export const HELP_TOPICS: HelpTopic[] = [...TOPICS_DAILY, ...TOPICS_STOCK, ...TOPICS_ADMIN];

/** Fiches d’un rôle, regroupées par chapitre (chapitres vides omis), dans l’ordre du manuel. */
export function manualFor(role: HelpRole): { chapter: HelpChapter; topics: HelpTopic[] }[] {
  return HELP_CHAPTERS.map((chapter) => ({
    chapter,
    topics: HELP_TOPICS.filter((t) => t.chapter === chapter.id && t.roles.includes(role)),
  })).filter((c) => c.topics.length > 0);
}

/** Motif de route (`/sales/:id`) → expression de correspondance d’un chemin réel. */
function routeMatches(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const q = path.split('/').filter(Boolean);
  if (p.length !== q.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === q[i]);
}

/** Fiche d’aide de l’écran affiché (la plus spécifique), ou `undefined`. */
export function topicForPath(path: string, role: HelpRole): HelpTopic | undefined {
  const clean = path.split('?')[0] ?? path;
  const matches = HELP_TOPICS.filter(
    (t) => t.roles.includes(role) && t.routes.some((r) => routeMatches(r, clean)),
  );
  // `/returns/new` doit l’emporter sur `/returns/:id`.
  return matches.sort((a, b) => score(b, clean) - score(a, clean))[0];
}

function score(topic: HelpTopic, path: string): number {
  return Math.max(
    ...topic.routes
      .filter((r) => routeMatches(r, path))
      .map((r) => r.split('/').filter((s) => s && !s.startsWith(':')).length),
  );
}

/** Rôle d’aide d’un utilisateur : administrateur ou préparateur (tout autre rôle suit le préparateur). */
export function helpRoleOf(isAdmin: boolean): HelpRole {
  return isAdmin ? 'ADMIN' : 'PREPARER';
}

export type AnswerBlock = { type: 'p'; text: string } | { type: 'ol'; items: string[] };

/** Découpe une réponse de FAQ : les lignes « 1. … » consécutives forment une liste numérotée. */
export function parseAnswer(lines: string[]): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const line of lines) {
    const m = /^\d+\.\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (m?.[1] !== undefined) {
      if (last?.type === 'ol') last.items.push(m[1]);
      else blocks.push({ type: 'ol', items: [m[1]] });
    } else blocks.push({ type: 'p', text: line });
  }
  return blocks;
}

/** Questions de la FAQ visibles par un rôle. */
export function faqFor(role: HelpRole): FaqEntry[] {
  return FAQ.filter((f) => f.roles.includes(role));
}

/** Questions de la FAQ liées à l’écran d’une fiche (même route). */
export function faqForTopic(topic: HelpTopic, role: HelpRole): FaqEntry[] {
  return faqFor(role).filter((f) => f.link !== undefined && topic.routes.includes(f.link));
}
