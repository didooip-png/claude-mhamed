/**
 * Aide intégrée et manuels : une seule source de contenu, utilisée par
 *  - le bouton « ? » de chaque écran (panneau d'aide contextuel),
 *  - la page Aide (FAQ, raccourcis, fiche mémo),
 *  - les manuels PDF par rôle et la fiche mémo (générés par `tools/docs`).
 * Le texte est en français ; les libellés cités (boutons, menus) sont ceux de l'interface.
 */
export type HelpRole = 'ADMIN' | 'PREPARER';

export const HELP_ROLE_LABELS: Record<HelpRole, string> = {
  ADMIN: 'Administrateur',
  PREPARER: 'Préparateur',
};

export interface HelpChapter {
  id: string;
  title: string;
  /** Présentation du chapitre, propre à chaque rôle (à défaut : `default`). */
  intro: { default: string; ADMIN?: string; PREPARER?: string };
}

export interface HelpTopic {
  id: string;
  chapter: string;
  title: string;
  /** Motifs de route (React Router, ex. `/sales/:id`) auxquels l'aide contextuelle s'applique. Vide : fiche de manuel seulement. */
  routes: string[];
  /** Rôles pour lesquels cet écran ou cette procédure existe. */
  roles: HelpRole[];
  /** À quoi sert l'écran, en une ou deux phrases. */
  summary: string;
  /** Étapes numérotées de la tâche principale. */
  steps: string[];
  /** Étapes ou remarques supplémentaires selon le rôle. */
  roleNotes?: Partial<Record<HelpRole, string[]>>;
  tips?: string[];
  warnings?: string[];
  shortcuts?: [keys: string, action: string][];
  /** Identifiant de la capture d'écran du manuel (voir `tools/docs/scenes.mjs`). */
  shot?: string;
  /** Légende de la capture. */
  shotCaption?: string;
}

export interface FaqEntry {
  id: string;
  question: string;
  roles: HelpRole[];
  /** Paragraphes ; une ligne commençant par « 1. » forme une liste numérotée avec les suivantes. */
  answer: string[];
  /** Écran concerné (lien « Ouvrir » de l'aide intégrée). */
  link?: string;
}

export interface TourStep {
  /** Valeur de l'attribut `data-tour` de l'élément à mettre en évidence ; absent = fenêtre centrée. */
  target?: string;
  title: string;
  text: string;
  roles?: HelpRole[];
}

export interface CheatSheetBlock {
  title: string;
  /** Liste numérotée (procédure) ou à puces. */
  kind: 'steps' | 'list' | 'keys';
  items: string[] | [string, string][];
}
