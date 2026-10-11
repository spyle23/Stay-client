/**
 * Lecture du capteur SMTP de la Phase 3 par le smoke cliente (spyle23/hotelerie#109).
 *
 * Avec `scripts/client-stack-up.ps1 -Root …`, le PMS envoie tous ses e-mails à un Mailpit local
 * (#99, `scripts/mail-catcher.mjs`), jamais à un vrai SMTP. Son API HTTP liste les messages captés
 * (`GET /api/v1/messages`, du plus récent au plus ancien) et rend un message avec ses corps
 * (`GET /api/v1/message/<ID>` : `Text`, `HTML`). Le PMS envoie par un job Hangfire, donc après la
 * réponse HTTP : `lastMail` sonde le capteur jusqu'à l'arrivée de l'e-mail ou la fin du délai.
 *
 * Aucune écriture : le helper ne fait que lire le capteur (ni la base, ni le vidage de la boîte,
 * réservé à `*-stack-up` / `*-stack-down`).
 *
 * Volontairement sans import Playwright : le helper est testé en unitaire par Vitest
 * (`src/tests/lib/smoke-mail.test.ts`).
 */

/** Capteur des stacks Phase 3 quand ni `MAIL_CATCHER_URL` ni `MAIL_CATCHER_HTTP_PORT` ne sont fournis. */
export const DEFAULT_MAIL_CATCHER_URL = "http://localhost:8025";

/** Délai de sondage par défaut : l'envoi passe par la file Hangfire du PMS (sondée toutes les ~15 s). */
export const DEFAULT_MAIL_TIMEOUT_MS = 45_000;

/** Adresse d'un destinataire, telle que la liste l'API Mailpit. */
export interface MailpitAddress {
  Address?: string;
  Name?: string;
}

/** Résumé d'un message, tel que le liste `GET /api/v1/messages`. */
export interface MailpitSummary {
  ID: string;
  To?: MailpitAddress[] | null;
  Subject?: string;
  Created: string;
}

/** Corps d'un message, tels que les rend `GET /api/v1/message/<ID>`. */
export interface MailpitBodies {
  Text?: string;
  HTML?: string;
}

/** E-mail capté, rendu à la spec du smoke. */
export interface CapturedMail {
  id: string;
  /** Destinataires, en minuscules. */
  to: string[];
  subject: string;
  text: string;
  html: string;
  created: string;
  /** Premier lien correspondant à `match` (premier lien tout court sans `match`), `null` s'il n'y en a pas. */
  link: string | null;
  /** Tous les liens (texte puis HTML), filtrés par `match`. */
  links: string[];
}

export interface LastMailOptions {
  /** Destinataire (casse ignorée). */
  to: string;
  /** Ne garde que les liens qui correspondent à ce motif. */
  match?: RegExp | string;
  /** Durée de sondage avant l'échec (défaut 45 s). */
  timeoutMs?: number;
  /** Intervalle entre deux sondages (défaut 500 ms). */
  intervalMs?: number;
  /** Ignore les e-mails captés avant cet instant (ceux d'un passage précédent). */
  since?: Date | string;
  /** URL du capteur (défaut : `mailCatcherUrl()`). */
  baseUrl?: string;
  /** Injecté par les tests unitaires (défaut : `fetch` global). */
  fetch?: typeof fetch;
}

/**
 * URL du capteur, sans barre oblique finale : `MAIL_CATCHER_URL`, sinon le port HTTP du capteur
 * (`MAIL_CATCHER_HTTP_PORT`, la surcharge que lit aussi `scripts/mail-catcher.mjs`), sinon :8025.
 */
export function mailCatcherUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.MAIL_CATCHER_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = env.MAIL_CATCHER_HTTP_PORT?.trim();
  return port ? `http://localhost:${port}` : DEFAULT_MAIL_CATCHER_URL;
}

const addressesOf = (message: MailpitSummary): string[] =>
  (message.To ?? []).map((a) => String(a?.Address ?? "").toLowerCase());

/** Message le plus récent (`Created`) adressé à `to` (casse ignorée), capté à partir de `since` ; `null` sinon. */
export function pickLatest(
  messages: readonly MailpitSummary[],
  to: string,
  since?: Date | string,
): MailpitSummary | null {
  const wanted = to.trim().toLowerCase();
  const from = since === undefined ? null : new Date(since).getTime();
  const candidates = messages.filter(
    (m) =>
      addressesOf(m).includes(wanted) &&
      (from === null || Date.parse(m.Created) >= from),
  );
  candidates.sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
  return candidates[0] ?? null;
}

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x3D;|&#61;/gi, "=")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Liens http(s) d'un message : ceux du texte d'abord, puis ceux du HTML (attributs `href`, puis
 * texte brut, entités décodées), sans doublon, ponctuation finale retirée, filtrés par `match`.
 */
export function extractLinks(
  message: MailpitBodies,
  match?: RegExp | string,
): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const url = decodeEntities(raw).replace(/[.,;:!?)\]}>'"]+$/, "");
    if (url && !found.includes(url)) found.push(url);
  };
  for (const m of String(message.Text ?? "").matchAll(
    /https?:\/\/[^\s<>"']+/g,
  )) {
    add(m[0]);
  }
  const html = String(message.HTML ?? "");
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    if (/^https?:\/\//i.test(m[1])) add(m[1]);
  }
  for (const m of html
    .replace(/href\s*=\s*["'][^"']*["']/gi, "")
    .matchAll(/https?:\/\/[^\s<>"']+/g)) {
    add(m[0]);
  }
  if (match === undefined) return found;
  const pattern = typeof match === "string" ? new RegExp(match) : match;
  // Une RegExp globale ou collante garde son `lastIndex` d'un `test` à l'autre : copie sans ces drapeaux.
  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  return found.filter((url) => re.test(url));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Le capteur a répondu, mais en erreur HTTP (à distinguer d'un capteur qui ne répond pas). */
class CatcherHttpError extends Error {}

async function getJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new CatcherHttpError(
      `capteur SMTP : HTTP ${response.status} sur ${url}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * Dernier e-mail capté pour `to`, avec son premier lien correspondant à `match`.
 *
 * Sonde le capteur jusqu'à `timeoutMs` (envoi asynchrone). Échecs explicites :
 * - aucun e-mail pour le destinataire à la fin du délai : « Aucun e-mail pour <to> … » ;
 * - capteur injoignable pendant tout le délai : « capteur SMTP injoignable sur <url> … » ;
 * - réponse HTTP en erreur du capteur : échec immédiat (rien ne sert d'attendre).
 */
export async function lastMail(
  options: LastMailOptions,
): Promise<CapturedMail> {
  const to = options.to?.trim();
  if (!to) throw new Error("lastMail : destinataire (`to`) requis");
  const baseUrl = (options.baseUrl ?? mailCatcherUrl()).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MAIL_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let unreachable: string | null = null;

  for (;;) {
    let latest: MailpitSummary | null = null;
    try {
      const listing = await getJson<{ messages?: MailpitSummary[] }>(
        fetcher,
        `${baseUrl}/api/v1/messages?limit=500`,
      );
      unreachable = null;
      latest = pickLatest(listing.messages ?? [], to, options.since);
    } catch (error) {
      if (error instanceof CatcherHttpError) throw error;
      unreachable = error instanceof Error ? error.message : String(error);
    }

    if (latest) {
      const bodies = await getJson<MailpitBodies>(
        fetcher,
        `${baseUrl}/api/v1/message/${encodeURIComponent(latest.ID)}`,
      );
      const links = extractLinks(bodies, options.match);
      return {
        id: latest.ID,
        to: addressesOf(latest),
        subject: latest.Subject ?? "",
        text: bodies.Text ?? "",
        html: bodies.HTML ?? "",
        created: latest.Created,
        link: links[0] ?? null,
        links,
      };
    }

    if (Date.now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  if (unreachable !== null) {
    throw new Error(
      `capteur SMTP injoignable sur ${baseUrl} pendant ${timeoutMs} ms (${unreachable}) : ` +
        "lancer le stack par scripts/client-stack-up.ps1, ou MAIL_CATCHER_URL",
    );
  }
  const since =
    options.since === undefined
      ? ""
      : ` depuis ${new Date(options.since).toISOString()}`;
  throw new Error(
    `Aucun e-mail pour ${to}${since} dans le capteur ${baseUrl} après ${timeoutMs} ms`,
  );
}
