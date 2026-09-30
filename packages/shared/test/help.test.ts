import { describe, expect, it } from 'vitest';
import {
  CHEAT_SHEET,
  FAQ,
  HELP_CHAPTERS,
  HELP_TOPICS,
  TOUR_STEPS,
  helpRoleOf,
  manualFor,
  topicForPath,
} from '../src/index.js';

describe('contenu d’aide', () => {
  it('a des identifiants uniques et des chapitres existants', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const faqIds = FAQ.map((f) => f.id);
    expect(new Set(faqIds).size).toBe(faqIds.length);
    const chapters = new Set(HELP_CHAPTERS.map((c) => c.id));
    for (const t of HELP_TOPICS) expect(chapters.has(t.chapter), t.id).toBe(true);
  });

  it('chaque fiche est complète', () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.length, t.id).toBeGreaterThan(3);
      expect(t.summary.length, t.id).toBeGreaterThan(20);
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      expect(t.roles.length, t.id).toBeGreaterThan(0);
      for (const s of [t.summary, ...t.steps, ...(t.tips ?? []), ...(t.warnings ?? [])])
        expect(s, t.id).not.toMatch(/\s{2,}|\s$|^\s/);
    }
  });

  it('les liens de la FAQ pointent vers un écran documenté', () => {
    const routes = HELP_TOPICS.flatMap((t) => t.routes);
    for (const f of FAQ) {
      expect(f.answer.length, f.id).toBeGreaterThan(0);
      if (f.link)
        expect(
          routes.some((r) => r === f.link),
          `${f.id} → ${f.link}`,
        ).toBe(true);
    }
  });

  it('les deux manuels couvrent tous les chapitres utiles', () => {
    const admin = manualFor('ADMIN').flatMap((c) => c.topics);
    const preparer = manualFor('PREPARER').flatMap((c) => c.topics);
    expect(admin.length).toBeGreaterThan(preparer.length);
    expect(preparer.some((t) => t.id === 'pos')).toBe(true);
    // Le préparateur ne voit aucune procédure réservée à l’administrateur.
    expect(preparer.some((t) => t.id === 'users' || t.id === 'audit')).toBe(false);
  });

  it('associe une route à la fiche la plus précise', () => {
    expect(topicForPath('/returns/new', 'PREPARER')?.id).toBe('return-new');
    expect(topicForPath('/returns/abc', 'PREPARER')?.id).not.toBe('return-new');
    expect(topicForPath('/sales/on-hold', 'PREPARER')?.id).toBe('sales-on-hold');
    expect(topicForPath('/sales/1234', 'PREPARER')?.id).toBe('sale-detail');
    expect(topicForPath('/admin/users', 'PREPARER')).toBeUndefined();
    expect(topicForPath('/admin/users', 'ADMIN')?.id).toBe('users');
    expect(helpRoleOf(true)).toBe('ADMIN');
  });

  it('la fiche mémo et la visite guidée sont renseignées', () => {
    expect(CHEAT_SHEET.length).toBeGreaterThanOrEqual(5);
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(TOUR_STEPS.map((s) => s.target).filter(Boolean)).size).toBeGreaterThan(4);
  });
});
