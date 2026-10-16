import { defineConfig, devices } from "@playwright/test";

import { chromiumLaunchOptions } from "./e2e/launch-options";
import { E2E_DEV_SERVER_ENV } from "./src/lib/e2e-dev-server";
import { resolveE2EPort } from "./e2e/web-port";
import { resolveE2EWorkers } from "./e2e/workers";

/**
 * Port du serveur web lu depuis `E2E_PORT` (défaut 3000, spyle23/hotelerie#106) : un worktree de
 * ticket reçoit un port propre des portes et de `resource-lock.mjs run e2e-web`.
 */
const E2E_PORT = resolveE2EPort();
const WEB_URL = `http://localhost:${E2E_PORT}`;
const hasTicketPort = !!process.env.E2E_PORT?.trim();

// Config e2e front (Story 1.1 — socle e2e). Démarre le dev server puis teste le parcours.
export default defineConfig({
  testDir: "./src/tests/e2e",
  // Specs de production (`next start`, #148) : config dédiée `playwright.prod.config.ts`.
  testIgnore: ["**/prod/**"],
  // Chaque route compilée une fois avant le premier test (#198) : le serveur webpack compile à la
  // demande, et une route froide dépassait le délai d'un test sous plusieurs workers.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /**
   * Plafond de parallélisme (story 2.2). Le `webServer` est un **dev server** (webpack, #190) qui
   * compile chaque route **à la demande** : au-delà de ~4 workers, plusieurs compilations à froid
   * se déclenchent simultanément et des assertions franchissent le timeout de 5 s — des échecs
   * qui n'ont rien à voir avec le code testé (constaté en ajoutant les routes du tunnel).
   * Borner les workers rend la suite déterministe **sans** relâcher les timeouts d'assertion, et
   * s'avère même plus rapide (moins de contention). En CI, Playwright reste libre de s'adapter.
   * `E2E_WORKERS` (budget des portes, #178) abaisse ce plafond, CI comprise.
   */
  workers: resolveE2EWorkers(process.env.CI ? undefined : 4),
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    // Sans GPU (#178) : écran bleu sous la charge des runs parallèles.
    launchOptions: chromiumLaunchOptions(),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    /**
     * `next dev` **sans Turbopack** (`dev:e2e`, webpack, spyle23/hotelerie#190) : sous Next 16,
     * Turbopack est le défaut et engendrait des centaines de workers `.next/dev` (559 sous #183)
     * jusqu'à l'épuisement de la mémoire de la machine. `yarn dev` (interactif) reste en Turbopack.
     * Port explicite (`-p` et `PORT`) quand E2E_PORT est fourni ; sinon port par défaut (3000).
     */
    command: hasTicketPort ? `yarn dev:e2e -p ${E2E_PORT}` : "yarn dev:e2e",
    url: WEB_URL,
    // Routes compilées gardées pendant toute la suite (#198, `src/lib/e2e-dev-server.ts`).
    env: { PORT: String(E2E_PORT), [E2E_DEV_SERVER_ENV]: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
