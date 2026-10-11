import { defineConfig, devices } from "@playwright/test";

import { resolveE2EPort } from "./e2e/web-port";

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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /**
   * Plafond de parallélisme (story 2.2). Le `webServer` est un **dev server Turbopack** qui
   * compile chaque route **à la demande** : au-delà de ~4 workers, plusieurs compilations à froid
   * se déclenchent simultanément et des assertions franchissent le timeout de 5 s — des échecs
   * qui n'ont rien à voir avec le code testé (constaté en ajoutant les routes du tunnel).
   * Borner les workers rend la suite déterministe **sans** relâcher les timeouts d'assertion, et
   * s'avère même plus rapide (moins de contention). En CI, Playwright reste libre de s'adapter.
   */
  workers: process.env.CI ? undefined : 4,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Port explicite (`-p` et `PORT`) quand E2E_PORT est fourni ; sinon commande historique.
    command: hasTicketPort ? `yarn dev -p ${E2E_PORT}` : "yarn dev",
    url: WEB_URL,
    env: { PORT: String(E2E_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
