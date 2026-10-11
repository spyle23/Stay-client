import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl SANS routing d'URL : le plugin pointe vers la config de requête qui
// résout la locale depuis le cookie `NEXT_LOCALE` (src/i18n/request.ts).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Métadonnées **bloquantes** pour tous les agents (spyle23/hotelerie#148, AC-3).
 *
 * Par défaut, Next.js 16 diffuse les métadonnées en flux pour les navigateurs : le document part
 * sans `<title>` dans `<head>`, et une navigation client retire l'ancien titre avant que le nouveau
 * ne soit résolu. Mesuré en `next start` : aucun `<title>` au `DOMContentLoaded` (5/5), titre vide
 * pendant ~300 ms sur 2 navigations fiche hôtel → fiche chambre sur 5 (audit axe `document-title`
 * en échec). Bloquantes, elles sont résolues avant le corps du document : le titre n'est jamais vide.
 * Coût : le premier octet d'un document attend `generateMetadata` (un appel BFF, dédupliqué avec la
 * page par `cache`). Les navigations client restent diffusées en flux (squelette `loading.tsx`).
 */
export const BLOCKING_METADATA_FOR_ALL_AGENTS = /.*/;

const nextConfig: NextConfig = {
  // Conteneurisation : build autonome pour l'image Docker (Story 1.1, AC-1/AC-6)
  output: "standalone",
  htmlLimitedBots: BLOCKING_METADATA_FOR_ALL_AGENTS,
  // Build de production des e2e isolés dans un dossier à part (#148, `playwright.prod.config.ts`) :
  // le `.next` des portes, réutilisé par la Phase 3, n'est jamais écrasé.
  distDir: process.env.STAY_CLIENT_DIST_DIR || ".next",
};

export default withNextIntl(nextConfig);
