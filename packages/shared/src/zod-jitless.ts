import { z } from 'zod';

/**
 * Site web sous CSP sans « unsafe-eval » : Zod ne doit pas compiler ses schémas à la volée.
 * `public/zod-init.js` (script classique chargé avant l'application) positionne l'indicateur ;
 * ce module est le premier importé par l'index du paquet, donc évalué avant tout schéma.
 * L'API (Node) ne pose pas l'indicateur et conserve la compilation, plus rapide.
 */
if ((globalThis as { __ZOD_JITLESS__?: boolean }).__ZOD_JITLESS__) z.config({ jitless: true });
