import { defineConfig, devices } from "@playwright/test";

import { resolveE2EPort } from "./e2e/web-port";
import { E2E_PROD_DIST_DIR } from "./e2e/prod-build";

/**
 * Config e2e isolée **en production** (spyle23/hotelerie#148).
 *
 * Les e2e isolés (`playwright.config.ts`) tournent sur `next dev`, où Next.js ne précharge aucun
 * lien (préchargement réservé à la production). Les courses entre préchargement et navigation
 * (fiche hôtel blanche, #148) ne se reproduisent donc qu'ici : `next build` puis `next start`.
 *
 * - Même port que les e2e isolés (`E2E_PORT`, verrou des portes) : `yarn test:e2e` lance les deux
 *   configs l'une après l'autre, jamais en même temps.
 * - Build dans un dossier séparé (`STAY_CLIENT_DIST_DIR`) : le `.next` des portes, réutilisé par la
 *   Phase 3 (`scripts/phase3-front.mjs`), n'est jamais écrasé.
 * - L'API reste celle que fournissent les portes (`NEXT_PUBLIC_API_URL`, port fermé, #95) : le
 *   navigateur est simulé par `page.route`, le rendu serveur retombe sur ses états dégradés.
 */
const E2E_PORT = resolveE2EPort();
const WEB_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./src/tests/e2e/prod",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `yarn build && yarn start -p ${E2E_PORT}`,
    url: WEB_URL,
    env: { PORT: String(E2E_PORT), STAY_CLIENT_DIST_DIR: E2E_PROD_DIST_DIR },
    // Jamais un serveur déjà en écoute : ce serait tester un autre build (dev, autre ticket).
    reuseExistingServer: false,
    // `next build` complet avant le démarrage, sous la charge des tickets parallèles.
    timeout: 600_000,
  },
});
