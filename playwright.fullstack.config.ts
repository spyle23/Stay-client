import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright « full-stack smoke » — Phase 3, périmètre CLIENT (voir CLAUDE.md racine).
 *
 * Différence avec `playwright.config.ts` : les e2e classiques tournent en isolation
 * (dev server local, API mockée). Ce smoke-là tourne contre le VRAI stack client :
 *   stay-client (:3001) → stay-client-bff (:4000) → Stay-api PMS (:5231) → Postgres,
 *   stay-client-bff → Redis (:6379).
 *
 * Il NE démarre PAS les serveurs : le stack client doit déjà être lancé via
 * `scripts/client-stack-up.ps1` (front :3001 + BFF :4000 + PMS :5231 + Redis).
 *
 * Le front tourne sur :3001 (et non :3000) pour coexister avec le back-office Stay.
 */
const WEB_URL = process.env.SMOKE_WEB_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e/smoke",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
