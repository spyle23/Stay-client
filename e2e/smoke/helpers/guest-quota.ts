import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "@playwright/test";

/**
 * Cadence des provisionnements d'invité du smoke (`POST /auth/guest`, #148).
 *
 * Le BFF limite ce point d'entrée par adresse IP (`THROTTLE_IP_LIMIT`, 10 par fenêtre de 60 s par
 * défaut, puis 429 pendant `THROTTLE_BLOCK_MS`). Un passage du smoke provisionne une dizaine
 * d'invités (identification, paiement) : tant que l'attente des préchargements RSC (#125) le
 * ralentissait, il restait le plus souvent sous le seuil ; sans elle (#148), il le franchit (429
 * constatés en Phase 3, plus encore sur deux passages de suite). Le smoke se cale donc sur un quota inférieur au seuil du BFF,
 * compté entre les specs et entre deux passages (fichier d'état propre à l'URL du front).
 *
 * Rien n'est rejoué : on attend **avant** de soumettre, jamais après un 429.
 */
export interface GuestQuota {
  /** Provisionnements autorisés par fenêtre (sous le seuil du BFF, marge comprise). */
  limit: number;
  /** Fenêtre de comptage (ms), celle du BFF. */
  windowMs: number;
}

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Quota du smoke : `SMOKE_GUEST_LIMIT` (8) par `SMOKE_GUEST_WINDOW_MS` (60 000 ms + marge). */
export function resolveGuestQuota(env: Env = process.env): GuestQuota {
  return {
    limit: positiveInt(env.SMOKE_GUEST_LIMIT, 8),
    windowMs: positiveInt(env.SMOKE_GUEST_WINDOW_MS, 61_000),
  };
}

/** Provisionnements encore dans la fenêtre à l'instant `now`. */
export function recentSubmissions(
  timestamps: readonly number[],
  now: number,
  quota: GuestQuota,
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

function stateFile(env: Env): string {
  const front = env.SMOKE_WEB_URL ?? "http://localhost:3001";
  const key = createHash("sha1").update(front).digest("hex").slice(0, 12);
  return join(tmpdir(), `stay-client-smoke-guest-${key}.json`);
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attend, si besoin, que le quota d'invités permette une nouvelle soumission, puis l'enregistre.
 * À appeler juste avant le clic qui soumet le formulaire d'invité.
 */
export async function awaitGuestQuota(env: Env = process.env): Promise<number> {
  const quota = resolveGuestQuota(env);
  const file = stateFile(env);
  const waitMs = delayBeforeNextSubmission(
    readTimestamps(file),
    Date.now(),
    quota,
  );
  if (waitMs > 0) {
    // L'attente s'ajoute au délai du test, au lieu de le consommer.
    const info = test.info();
    info.setTimeout(info.timeout + waitMs);
    info.annotations.push({
      type: "guest-quota",
      description: `provisionnement d'invité différé de ${Math.round(waitMs / 1000)} s (quota du BFF)`,
    });
    await sleep(waitMs);
  }
  const now = Date.now();
  writeFileSync(
    file,
    JSON.stringify([
      ...recentSubmissions(readTimestamps(file), now, quota),
      now,
    ]),
  );
  return waitMs;
}
