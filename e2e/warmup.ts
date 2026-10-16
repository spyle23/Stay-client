/**
 * Préchauffage du serveur des e2e isolés (spyle23/hotelerie#198, suite de #190).
 *
 * Sous webpack (`yarn dev:e2e`, #190), `next dev` compile chaque route à sa première requête. À 3-4
 * workers, un test qui naviguait vers une route encore froide payait sa compilation dans son propre
 * délai (`booking-identify.spec.ts`, paiement et récapitulatif), et la compilation d'une nouvelle
 * route rechargeait les pages ouvertes ailleurs (`nearby.spec.ts`, audit axe : « Execution context
 * was destroyed »). Le global setup (`e2e/global-setup.ts`) demande donc une fois chaque route de
 * `src/app`, une fois le serveur prêt et avant le premier test, comme celui de `Stay` (#190).
 * Les routes restent compilées pendant toute la suite (`onDemandEntries`, `src/lib/e2e-dev-server.ts`).
 *
 * Le préchauffage ne fait jamais échouer la suite : une page en erreur (l'API des e2e isolés est un
 * port fermé, #95) est compilée quand même, une requête en échec est seulement signalée.
 * `E2E_WARMUP=0` le désactive (spec isolée en débogage).
 *
 * Sans import de `@playwright/test` : testé par Vitest (`src/tests/lib/e2e-warmup.test.ts`).
 */

import { readdirSync } from "node:fs";
import path from "node:path";

/** Valeur donnée à un segment dynamique (`[slug]`) : la page compile quelle que soit la valeur. */
export const WARMUP_DYNAMIC_SEGMENT = "e2e-warmup";

/** Route inconnue : compile la page 404 (des specs visitent des identifiants invalides). */
export const WARMUP_NOT_FOUND_ROUTE = "/e2e-warmup-not-found";

/** Requêtes simultanées : webpack les regroupe dans une même compilation. */
export const DEFAULT_WARMUP_CONCURRENCY = 4;

/** Délai d'une requête : une route qui ne répond pas est abandonnée, la suite démarre quand même. */
export const DEFAULT_WARMUP_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Cookie de session dont le proxy (`src/proxy.ts`) teste la seule présence sur `/account` : sans
 * lui, la requête serait redirigée et seule `/login` serait compilée.
 */
const SESSION_COOKIE = "stay_sid";
const PROTECTED_PREFIXES = ["/account"];

type Env = Record<string, string | undefined>;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Actif par défaut ; `E2E_WARMUP=0` le désactive. */
export function e2eWarmupEnabled(env: Env = process.env): boolean {
  return env.E2E_WARMUP?.trim() !== "0";
}

/** URL de chaque `page.tsx` sous `appDir` : groupes de routes retirés, segments dynamiques remplis. */
export function listAppRoutes(appDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (name.startsWith("_") || name.startsWith("@")) continue;
        const next = /^\(.*\)$/.test(name)
          ? segments
          : [
              ...segments,
              /^\[.*\]$/.test(name) ? WARMUP_DYNAMIC_SEGMENT : name,
            ];
        walk(path.join(dir, name), next);
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
        routes.push("/" + segments.join("/"));
      }
    }
  };
  walk(appDir, []);
  return [...new Set(routes)].sort();
}

/** Routes préchauffées : celles de l'application, puis une route inconnue (page 404). */
export function warmupRoutes(appDir: string): string[] {
  return [...listAppRoutes(appDir), WARMUP_NOT_FOUND_ROUTE];
}

/** En-tête `Cookie` qui laisse le proxy servir `route` au lieu de rediriger (aucun ailleurs). */
export function warmupCookie(route: string): string | undefined {
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
  return isProtected
    ? `${SESSION_COOKIE}=${WARMUP_DYNAMIC_SEGMENT}`
    : undefined;
}

export type WarmupResult = {
  routes: number;
  failed: string[];
  durationMs: number;
};

/**
 * Demande chaque route une fois (`concurrency` à la fois), sans jamais suivre une redirection.
 *
 * Seuls les documents sont demandés, pas les scripts qu'ils chargent : mesuré sous #198, demander en
 * plus les ressources `/_next/` de chaque page ralentissait ensuite le serveur (confirmation répétée
 * 3 fois à 4 workers : 30 échecs sur 57 et 10 s par test, contre 0 échec et 3 s avec les seuls
 * documents).
 */
export async function warmupE2EServer({
  baseURL,
  routes,
  fetch: doFetch = (url, init) => fetch(url, init),
  concurrency = DEFAULT_WARMUP_CONCURRENCY,
  requestTimeoutMs = DEFAULT_WARMUP_REQUEST_TIMEOUT_MS,
}: {
  baseURL: string;
  routes: string[];
  fetch?: Fetch;
  concurrency?: number;
  requestTimeoutMs?: number;
}): Promise<WarmupResult> {
  const startedAt = Date.now();
  const failed: string[] = [];
  const queue = [...routes];
  const worker = async () => {
    for (let route = queue.shift(); route; route = queue.shift()) {
      const cookie = warmupCookie(route);
      try {
        const response = await doFetch(new URL(route, baseURL).toString(), {
          redirect: "manual",
          headers: cookie ? { cookie } : {},
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        // Corps lu jusqu'au bout : le rendu en flux (et sa compilation) va à son terme.
        await response.arrayBuffer().catch(() => undefined);
      } catch {
        failed.push(route);
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, routes.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return {
    routes: routes.length,
    failed: failed.sort(),
    durationMs: Date.now() - startedAt,
  };
}
