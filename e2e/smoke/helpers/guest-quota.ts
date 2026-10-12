import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, type Page, type Response } from "@playwright/test";

/**
 * Cadence des provisionnements d'invité du smoke (`POST /auth/guest`, #148, #154).
 *
 * Le BFF limite ce point d'entrée par adresse IP (`THROTTLE_IP_LIMIT`, 10 par fenêtre fixe de 60 s
 * par défaut, compteur Redis, puis 429 pendant `THROTTLE_BLOCK_MS`). Un passage du smoke provisionne
 * une dizaine d'invités (identification, paiement) : deux passages de suite franchissaient le seuil
 * (429 constatés en Phase 3, #109, #148). La limite du BFF n'est pas touchée (#154 AC-2) : c'est le
 * smoke qui se cale dessus, de deux façons cumulées (la plus longue attente l'emporte).
 *
 * 1. **Quota local** (#148) : au plus `SMOKE_GUEST_LIMIT` soumissions par `SMOKE_GUEST_WINDOW_MS`
 *    glissantes, sous le seuil du BFF, comptées entre les specs et entre deux passages (fichier
 *    d'état propre à l'URL du front).
 * 2. **Compteur réel du BFF** (#154) : chaque réponse de `POST /auth/guest` porte le reste et
 *    l'échéance du compteur par IP (`X-RateLimit-Remaining-ip`, `X-RateLimit-Reset-ip` en secondes,
 *    `Retry-After-ip` sur un 429). Le smoke les relève (`submitGuestForm`) dans un fichier d'état
 *    propre au BFF (`SMOKE_BFF_URL`), si bien qu'il voit aussi les provisionnements faits hors de
 *    lui : navigation MCP de la Phase 3, passage ciblé, smoke d'un front lancé sur un autre port
 *    (`-WebPort`), smoke de la base rejoué par `smoke-baseline.mjs`. Quand le reste estimé tombe à
 *    `SMOKE_GUEST_SPARE` places (1 par défaut), la soumission suivante attend la fin de la fenêtre.
 *
 * Rien n'est rejoué : on attend **avant** de soumettre, jamais après un 429.
 */
export interface GuestQuota {
  /** Provisionnements autorisés par fenêtre glissante (sous le seuil du BFF, marge comprise). */
  limit: number;
  /** Fenêtre de comptage locale (ms), celle du BFF plus une marge. */
  windowMs: number;
  /** Places du compteur du BFF laissées libres (provisionnements concurrents imprévus). */
  spare: number;
}

/** Compteur par IP du BFF tel que relevé sur une réponse de `POST /auth/guest`. */
export interface BffQuotaObservation {
  /** Provisionnements encore admis par le BFF dans sa fenêtre courante. */
  remaining: number;
  /** Instant (ms epoch) où la fenêtre (ou le blocage) du BFF expire. */
  resetAt: number;
  /** Instant (ms epoch) du relevé. */
  observedAt: number;
}

/** Marge ajoutée à l'échéance annoncée par le BFF (arrondie à la seconde supérieure, horloges). */
export const BFF_RESET_MARGIN_MS = 1_000;

/** BFF des stacks Phase 3 quand `SMOKE_BFF_URL` n'est pas fourni (même défaut que les specs). */
const DEFAULT_BFF_URL = "http://localhost:4000";

type Env = Record<string, string | undefined>;
type Headers = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Quota du smoke : `SMOKE_GUEST_LIMIT` (8) par `SMOKE_GUEST_WINDOW_MS` (60 000 ms + marge), et
 * `SMOKE_GUEST_SPARE` (1) places du compteur du BFF laissées libres.
 */
export function resolveGuestQuota(env: Env = process.env): GuestQuota {
  return {
    limit: positiveInt(env.SMOKE_GUEST_LIMIT, 8),
    windowMs: positiveInt(env.SMOKE_GUEST_WINDOW_MS, 61_000),
    spare: nonNegativeInt(env.SMOKE_GUEST_SPARE, 1),
  };
}

/** Provisionnements encore dans la fenêtre à l'instant `now`. */
export function recentSubmissions(
  timestamps: readonly number[],
  now: number,
  quota: Pick<GuestQuota, "windowMs">,
): number[] {
  return timestamps
    .filter((t) => now - t < quota.windowMs)
    .sort((a, b) => a - b);
}

/** Attente (ms) avant le prochain provisionnement : 0 tant que le quota n'est pas atteint. */
export function delayBeforeNextSubmission(
  timestamps: readonly number[],
  now: number,
  quota: GuestQuota,
): number {
  const recent = recentSubmissions(timestamps, now, quota);
  if (recent.length < quota.limit) return 0;
  // Le plus ancien des `limit` derniers doit sortir de la fenêtre.
  const oldest = recent[recent.length - quota.limit];
  return Math.max(0, oldest + quota.windowMs - now);
}

function seconds(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Compteur par IP lu dans les en-têtes d'une réponse de `POST /auth/guest` (noms en minuscules,
 * tels que les rend Playwright). Un 409 ou un 400 le portent aussi : la garde compte avant le
 * contrôleur. Sur un 429, la reprise est le plus long des blocages annoncés. `null` sans en-tête
 * exploitable (BFF sans limitation, réponse d'un autre serveur).
 */
export function parseBffQuota(
  status: number,
  headers: Headers,
  now: number,
): BffQuotaObservation | null {
  if (status === 429) {
    const blocks = Object.entries(headers)
      .filter(([name]) => name.toLowerCase().startsWith("retry-after"))
      .map(([, value]) => seconds(value))
      .filter((s): s is number => s !== null);
    if (blocks.length === 0) return null;
    return {
      remaining: 0,
      resetAt: now + Math.max(...blocks) * 1000,
      observedAt: now,
    };
  }
  const remaining = seconds(headers["x-ratelimit-remaining-ip"]);
  const reset = seconds(headers["x-ratelimit-reset-ip"]);
  if (remaining === null || reset === null) return null;
  return {
    remaining: Math.floor(remaining),
    resetAt: now + reset * 1000,
    observedAt: now,
  };
}

/**
 * Attente (ms) imposée par le compteur réel du BFF : le reste relevé, diminué des soumissions du
 * smoke postérieures au relevé, doit garder plus de `spare` places ; sinon on attend l'échéance
 * de la fenêtre (marge comprise). 0 sans relevé ou une fois la fenêtre échue (le compteur repart).
 */
export function delayFromBffQuota(
  observed: BffQuotaObservation | null,
  timestamps: readonly number[],
  now: number,
  quota: Pick<GuestQuota, "spare">,
): number {
  if (observed === null || now >= observed.resetAt) return 0;
  const since = timestamps.filter((t) => t > observed.observedAt).length;
  if (observed.remaining - since > quota.spare) return 0;
  return observed.resetAt - now + BFF_RESET_MARGIN_MS;
}

function stateKey(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

/** Répertoire des fichiers d'état : celui du système, sauf `SMOKE_GUEST_STATE_DIR` (tests). */
function stateDir(env: Env): string {
  return env.SMOKE_GUEST_STATE_DIR || tmpdir();
}

function stateFile(env: Env): string {
  const front = env.SMOKE_WEB_URL ?? "http://localhost:3001";
  return join(stateDir(env), `stay-client-smoke-guest-${stateKey(front)}.json`);
}

/** Relevé du compteur, propre au BFF : tous les fronts (ports) qui l'appellent le partagent. */
function bffStateFile(env: Env): string {
  const bff = env.SMOKE_BFF_URL ?? DEFAULT_BFF_URL;
  return join(
    stateDir(env),
    `stay-client-smoke-bff-quota-${stateKey(bff)}.json`,
  );
}

function readTimestamps(file: string): number[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((t): t is number => typeof t === "number")
      : [];
  } catch {
    return [];
  }
}

function readBffQuota(env: Env): BffQuotaObservation | null {
  try {
    const parsed = JSON.parse(
      readFileSync(bffStateFile(env), "utf8"),
    ) as Partial<BffQuotaObservation> | null;
    if (
      parsed !== null &&
      typeof parsed.remaining === "number" &&
      typeof parsed.resetAt === "number" &&
      typeof parsed.observedAt === "number"
    ) {
      return {
        remaining: parsed.remaining,
        resetAt: parsed.resetAt,
        observedAt: parsed.observedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Enregistre le compteur porté par une réponse de `POST /auth/guest`. Une réponse sans en-tête
 * exploitable laisse le relevé précédent en place. Rend l'observation retenue, `null` sinon.
 */
export function recordBffQuota(
  status: number,
  headers: Headers,
  env: Env = process.env,
  now: number = Date.now(),
): BffQuotaObservation | null {
  const observed = parseBffQuota(status, headers, now);
  if (observed !== null) {
    writeFileSync(bffStateFile(env), JSON.stringify(observed));
  }
  return observed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attend, si besoin, que le quota d'invités permette une nouvelle soumission, puis l'enregistre.
 * À appeler juste avant le clic qui soumet le formulaire d'invité (voir `submitGuestForm`).
 */
export async function awaitGuestQuota(env: Env = process.env): Promise<number> {
  const quota = resolveGuestQuota(env);
  const file = stateFile(env);
  const timestamps = readTimestamps(file);
  const observed = readBffQuota(env);
  const start = Date.now();
  const localWait = delayBeforeNextSubmission(timestamps, start, quota);
  const bffWait = delayFromBffQuota(observed, timestamps, start, quota);
  const waitMs = Math.max(localWait, bffWait);
  if (waitMs > 0) {
    // L'attente s'ajoute au délai du test, au lieu de le consommer.
    const info = test.info();
    info.setTimeout(info.timeout + waitMs);
    const cause =
      bffWait >= localWait
        ? `compteur du BFF presque épuisé, ${observed?.remaining ?? 0} restant(s) au dernier relevé`
        : "quota du smoke, sous le seuil du BFF";
    info.annotations.push({
      type: "guest-quota",
      description: `provisionnement d'invité différé de ${Math.round(waitMs / 1000)} s (${cause})`,
    });
    await sleep(waitMs);
  }
  const now = Date.now();
  // Les soumissions postérieures au relevé du BFF restent comptées tant que sa fenêtre court,
  // même au-delà de la fenêtre locale (BFF configuré avec une fenêtre plus longue).
  const latest = readBffQuota(env);
  const kept = readTimestamps(file).filter(
    (t) =>
      now - t < quota.windowMs ||
      (latest !== null && now < latest.resetAt && t > latest.observedAt),
  );
  writeFileSync(file, JSON.stringify([...kept.sort((a, b) => a - b), now]));
  return waitMs;
}

/** Réponse du BFF au provisionnement d'invité (`POST …/auth/guest`). */
export function isGuestProvisioning(response: Response): boolean {
  if (response.request().method() !== "POST") return false;
  try {
    return new URL(response.url()).pathname.endsWith("/auth/guest");
  } catch {
    return false;
  }
}

/**
 * Soumet le formulaire d'invité au rythme du BFF : attend le quota, clique sur `guest-submit`,
 * puis relève le compteur porté par la réponse du BFF pour les soumissions suivantes (y compris
 * celles d'un passage suivant). Rend l'observation relevée, `null` si le BFF n'a pas répondu
 * (formulaire refusé côté front) ou sans en-tête : le test conclut alors sur ses propres attentes.
 */
export async function submitGuestForm(
  page: Page,
  env: Env = process.env,
): Promise<BffQuotaObservation | null> {
  await awaitGuestQuota(env);
  const responded = page
    .waitForResponse(isGuestProvisioning, { timeout: 30_000 })
    .catch(() => null);
  await page.getByTestId("guest-submit").click();
  const response = await responded;
  if (response === null) return null;
  return recordBffQuota(response.status(), response.headers(), env);
}
