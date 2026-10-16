import path from "node:path";

import type { FullConfig } from "@playwright/test";

import { e2eWarmupEnabled, warmupE2EServer, warmupRoutes } from "./warmup";

/**
 * Global setup des e2e isolés (spyle23/hotelerie#198) : une fois le serveur web prêt (Playwright le
 * lance avant le global setup), chaque route est compilée avant le premier test ; aucun test ne paie
 * la compilation à la demande du serveur webpack. Voir `warmup.ts`.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!e2eWarmupEnabled()) {
    process.stdout.write("[e2e warmup] desactive (E2E_WARMUP=0)\n");
    return;
  }
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const routes = warmupRoutes(path.resolve(__dirname, "../src/app"));
  const { failed, durationMs } = await warmupE2EServer({ baseURL, routes });
  const seconds = (durationMs / 1000).toFixed(1);
  const errors = failed.length ? ` ; en erreur : ${failed.join(", ")}` : "";
  process.stdout.write(
    `[e2e warmup] ${routes.length} routes compilees en ${seconds} s${errors}\n`,
  );
}
