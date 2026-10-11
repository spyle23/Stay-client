import type { Page } from "@playwright/test";

/**
 * Sonde console / réseau partagée par les specs du smoke (#125).
 *
 * Phase 3 : « 0 erreur console/réseau » contre le vrai stack. Une seule règle de filtrage pour toutes
 * les specs : chaque copie locale divergeait (`booking-payment` filtrait les abandons, `booking-identify`
 * et `booking-recap` non), et le smoke cliente était rouge sur la base pour des requêtes que le
 * navigateur abandonne lui-même.
 *
 * Seul un **abandon** (`net::ERR_ABORTED`) peut être ignoré, et seulement dans ces cas :
 * - **requête RSC du front** (`?_rsc=` sur l'origine de la page), si c'est un **préchargement**
 *   (en-tête `Next-Router-Prefetch` ou `Next-Router-Segment-Prefetch`) ou si sa **réponse a été
 *   reçue**. Chromium signale `net::ERR_ABORTED` à la fin normale d'une réponse lue en flux par la
 *   page (mesuré en `next start`, #148 : statut 200 et corps complet reçus, aucun abandon côté page) ;
 *   le fetch RSC d'une **navigation** abandonné **sans réponse** reste compté (#77) ;
 * - **hôte externe nommé** (`EXTERNAL_ABORTABLE_HOSTS`) : Stripe.js, chargé dès qu'un écran devient
 *   payable, sa télémétrie (`m.stripe.network`, #146) et hCaptcha, chargé par l'iframe Stripe, sont
 *   abandonnés quand le test quitte la page ;
 * - **chemin déclaré** par la spec (`abortablePaths`), pour un appel qu'elle abandonne volontairement.
 *
 * Tout le reste compte : un autre code d'erreur, un appel au BFF ou au PMS, une ressource du front, un
 * préchargement d'une autre origine.
 */
export const ABORTED = "net::ERR_ABORTED";

/** Hôtes tiers (et leurs sous-domaines) dont un chargement interrompu n'est pas un défaut du produit. */
export const EXTERNAL_ABORTABLE_HOSTS: readonly string[] = [
  "js.stripe.com",
  "m.stripe.network",
  "hcaptcha.com",
];

export type IgnoredFailure =
  "rsc-prefetch" | "rsc-streamed" | "external-host" | "aborted-path";

export interface RequestFailure {
  /** URL complète de la requête en échec. */
  url: string;
  /** `request.failure().errorText` de Playwright. */
  errorText: string;
  /** Origine du front (celle de la page) ; `null` si inconnue : aucun préchargement n'est alors ignoré. */
  frontOrigin: string | null;
  /** Chemins (pathname) qu'une spec abandonne volontairement en quittant la page. */
  abortablePaths?: readonly RegExp[];
  /** Préchargement du routeur Next.js (en-têtes `Next-Router-Prefetch` / `-Segment-Prefetch`). */
  prefetch?: boolean;
  /** Une réponse (statut HTTP) a été reçue avant l'échec signalé. */
  responded?: boolean;
}

/** Préchargement du routeur Next.js, d'après les en-têtes de la requête. */
export function isRouterPrefetch(headers: Record<string, string>): boolean {
  return (
    headers["next-router-prefetch"] === "1" ||
    headers["next-router-segment-prefetch"] !== undefined
  );
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const isExternalHost = (hostname: string): boolean =>
  EXTERNAL_ABORTABLE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

/** Raison d'ignorer un échec réseau, ou `null` s'il doit être compté. */
export function ignoredRequestFailure(
  failure: RequestFailure,
): IgnoredFailure | null {
  if (failure.errorText !== ABORTED) return null;
  const url = parseUrl(failure.url);
  if (url === null) return null;
  if (
    failure.frontOrigin !== null &&
    url.origin === failure.frontOrigin &&
    url.searchParams.has("_rsc")
  ) {
    if (failure.prefetch) return "rsc-prefetch";
    // Réponse reçue : fin d'une réponse lue en flux, pas un abandon (#148).
    if (failure.responded) return "rsc-streamed";
    return null;
  }
  if (isExternalHost(url.hostname)) return "external-host";
  if (failure.abortablePaths?.some((path) => path.test(url.pathname))) {
    return "aborted-path";
  }
  return null;
}

/** Origine d'une URL de page, ou `null` (`about:blank`, URL illisible). */
export function originOf(pageUrl: string): string | null {
  const url = parseUrl(pageUrl);
  return url === null || url.origin === "null" ? null : url.origin;
}

export interface WatchOptions {
  /** Statuts HTTP volontairement provoqués par le scénario (ex. le 409 de collision). */
  expected?: readonly number[];
  /** Chemins qu'une spec abandonne volontairement (cf. `ignoredRequestFailure`). */
  abortablePaths?: readonly RegExp[];
}

/**
 * Collecte les erreurs **console ET réseau** de la page : console `error`, exception de page, requête
 * en échec (hors abandons ignorés ci-dessus) et réponse ≥ 400 d'un appel `/api/v1/`.
 */
export function watchForFailures(
  page: Page,
  options: WatchOptions = {},
): string[] {
  const expected = options.expected ?? [];
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Chromium journalise TOUTE réponse ≥ 400 en erreur console (« Failed to load resource: …
    // status of 409 ») : un statut volontairement provoqué est donc filtré ici aussi.
    const status = /status of (\d{3})/.exec(msg.text())?.[1];
    if (status !== undefined && expected.includes(Number(status))) return;
    failures.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
  page.on("requestfailed", async (req) => {
    const errorText = req.failure()?.errorText ?? "inconnu";
    const failure: RequestFailure = {
      url: req.url(),
      errorText,
      frontOrigin: originOf(page.url()),
      abortablePaths: options.abortablePaths,
      prefetch: isRouterPrefetch(req.headers()),
    };
    if (
      ignoredRequestFailure(failure) === null &&
      ignoredRequestFailure({ ...failure, responded: true }) !== null
    ) {
      // Seule la réponse peut encore l'innocenter : fetch RSC de navigation (lecture asynchrone).
      failure.responded = (await req.response().catch(() => null)) !== null;
    }
    if (ignoredRequestFailure(failure) !== null) return;
    failures.push(`requestfailed: ${req.method()} ${req.url()} — ${errorText}`);
  });
  page.on("response", (res) => {
    // Les documents et ressources tierces ne nous concernent pas : on surveille nos propres appels.
    if (
      res.status() >= 400 &&
      /\/api\/v1\//.test(res.url()) &&
      !expected.includes(res.status())
    ) {
      failures.push(
        `http ${res.status()}: ${res.request().method()} ${res.url()}`,
      );
    }
  });
  return failures;
}
