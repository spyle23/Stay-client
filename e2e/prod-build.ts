/**
 * Dossier du build de production des e2e isolés (spyle23/hotelerie#148, `playwright.prod.config.ts`).
 *
 * Distinct de `.next` : le build des portes y est estampillé et réutilisé par la Phase 3
 * (`scripts/phase3-front.mjs`) ; un build e2e (API sur un port fermé) ne doit jamais le remplacer.
 * Lu par `next.config.ts` via `STAY_CLIENT_DIST_DIR`.
 */
export const E2E_PROD_DIST_DIR = ".next-e2e";
