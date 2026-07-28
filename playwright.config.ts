import { defineConfig, devices } from "@playwright/test";

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
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "yarn dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
