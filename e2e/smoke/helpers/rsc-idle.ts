import type { Page, Request } from "@playwright/test";

import { originOf } from "./network-probe";

/**
 * Calme des requêtes RSC du front avant une interaction du smoke (#125, décision d'arbitrage).
 *
 * Contournement **limité au smoke**, suivi par #148 (qui le retirera) : en production (`next start`),
 * un clic sur une hotel-card pendant que Next.js précharge encore les liens visibles (`?_rsc=`) peut
 * annuler le fetch RSC de la navigation (`net::ERR_ABORTED`) et laisser la fiche hôtel blanche.
 * L'automate cliquait dès l'apparition des cartes ; un utilisateur, jamais aussi vite.
 *
 * Synchronisation seulement : on attend qu'aucune requête `_rsc=` vers l'origine du front ne soit en
 * cours depuis une fenêtre de calme, borne comprise, puis on rend la main **sans échec** à la borne.
 * Ni rechargement, ni nouvelle tentative : une page blanche qui survient malgré tout reste un échec.
 */
export const RSC_QUIET_MS = 300;
export const RSC_QUIET_TIMEOUT_MS = 10_000;
const POLL_MS = 50;

/** Une requête RSC du front : paramètre `_rsc` sur l'origine de la page. */
export function isFrontRscRequest(
  url: string,
  frontOrigin: string | null,
): boolean {
  if (frontOrigin === null) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === frontOrigin && parsed.searchParams.has("_rsc");
  } catch {
    return false;
  }
}

export type RscIdleResult = "quiet" | "timeout";

export interface RscIdleOptions {
  /** Durée sans aucune activité RSC exigée (ms). */
  quietMs?: number;
  /** Borne de l'attente (ms) : à la borne, on rend `timeout`, sans échec. */
  timeoutMs?: number;
}

export interface RscActivity {
  /** Requêtes RSC du front vues partir et pas encore terminées. */
  inFlight(): number;
  /** Attend le calme (aucune requête en cours, aucune activité depuis `quietMs`) ou la borne. */
  waitForQuiet(options?: RscIdleOptions): Promise<RscIdleResult>;
  /** Retire les écouteurs de la page. */
  dispose(): void;
}

type RscPage = Pick<Page, "on" | "off" | "url">;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Suit les requêtes RSC du front (`request`, `requestfinished`, `requestfailed`). À installer **avant**
 * que les liens deviennent visibles : une requête partie avant l'installation n'est pas comptée, mais
 * sa fin (activité) relance quand même la fenêtre de calme.
 */
export function watchRscActivity(
  page: RscPage,
  now: () => number = Date.now,
): RscActivity {
  const pending = new Set<Request>();
  let lastActivity = now();
  const isRsc = (request: Request): boolean =>
    isFrontRscRequest(request.url(), originOf(page.url()));

  const onRequest = (request: Request): void => {
    if (!isRsc(request)) return;
    pending.add(request);
    lastActivity = now();
  };
  const onSettled = (request: Request): void => {
    if (!isRsc(request)) return;
    pending.delete(request);
    lastActivity = now();
  };

  page.on("request", onRequest);
  page.on("requestfinished", onSettled);
  page.on("requestfailed", onSettled);

  return {
    inFlight: () => pending.size,
    async waitForQuiet({
      quietMs = RSC_QUIET_MS,
      timeoutMs = RSC_QUIET_TIMEOUT_MS,
    }: RscIdleOptions = {}): Promise<RscIdleResult> {
      const startedAt = now();
      for (;;) {
        const t = now();
        if (pending.size === 0 && t - lastActivity >= quietMs) return "quiet";
        if (t - startedAt >= timeoutMs) return "timeout";
        await sleep(POLL_MS);
      }
    },
    dispose() {
      page.off("request", onRequest);
      page.off("requestfinished", onSettled);
      page.off("requestfailed", onSettled);
    },
  };
}
