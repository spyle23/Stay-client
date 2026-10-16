import type { NextConfig } from "next";

/**
 * Serveur de dev des e2e isolés (spyle23/hotelerie#198, suite de #190).
 *
 * `playwright.config.ts` pose {@link E2E_DEV_SERVER_ENV}=1 pour le `next dev --webpack` qu'il lance ;
 * `next.config.ts` garde alors chaque route compilée pendant toute la suite. Par défaut, `next dev`
 * libère une route après 60 s sans requête (au-delà des 5 plus récentes) et la recompile à la visite
 * suivante : le préchauffage du global setup (`e2e/global-setup.ts`) serait perdu pour les routes
 * peu visitées, et une recompilation en cours de suite recharge les pages ouvertes par les autres
 * workers. `yarn dev` (interactif) et la production (`next build` / `next start`, Phase 3) ne
 * posent jamais la variable : ils sont inchangés.
 */
export const E2E_DEV_SERVER_ENV = "NEXT_E2E_DEV_SERVER";

/** Plus long que la suite complète (quelques minutes à 4 workers, ~20 min à 1 worker). */
export const E2E_PAGES_MAX_INACTIVE_AGE_MS = 60 * 60 * 1000;

/** Plus de routes que n'en compte l'application : aucune n'est évincée. */
export const E2E_PAGES_BUFFER_LENGTH = 1000;

type Env = Record<string, string | undefined>;

/** Surcharges de `next.config.ts` pour le serveur des e2e ; vides partout ailleurs. */
export function e2eDevServerOverrides(
  env: Env = process.env,
): Pick<NextConfig, "onDemandEntries"> {
  if (env[E2E_DEV_SERVER_ENV] !== "1") return {};
  return {
    onDemandEntries: {
      maxInactiveAge: E2E_PAGES_MAX_INACTIVE_AGE_MS,
      pagesBufferLength: E2E_PAGES_BUFFER_LENGTH,
    },
  };
}
