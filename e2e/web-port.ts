/**
 * Port du serveur web des e2e isolés (spyle23/hotelerie#106).
 *
 * Dans un worktree de ticket (`.worktrees/<N>`), les portes (`scripts/quality-gates.ps1`) et
 * `scripts/resource-lock.mjs run e2e-web` passent `E2E_PORT` (3100 + N mod 800) et prennent le
 * verrou `e2e-web-<port>` : les e2e de tickets parallèles ne se sérialisent plus sur :3000.
 * Sans `E2E_PORT`, le comportement historique est conservé (port 3000).
 *
 * Ne concerne pas le smoke Phase 3 (`playwright.fullstack.config.ts`, `SMOKE_WEB_URL`).
 */
export const DEFAULT_E2E_PORT = 3000;

type Env = Record<string, string | undefined>;

/** Port des e2e : `E2E_PORT` s'il est défini, sinon 3000. Une valeur invalide est une erreur. */
export function resolveE2EPort(env: Env = process.env): number {
  const raw = env.E2E_PORT?.trim();
  if (!raw) return DEFAULT_E2E_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `E2E_PORT invalide : « ${raw} » (entier de 1 à 65535 attendu)`,
    );
  }
  return port;
}
