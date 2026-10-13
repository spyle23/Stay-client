/**
 * Workers Playwright bornés par `E2E_WORKERS` (spyle23/hotelerie#178, suite de #177).
 *
 * Les portes (`scripts/quality-gates.ps1`) passent `E2E_WORKERS` = budget de l'étape e2e (borné par
 * la mémoire disponible et le nombre de tickets actifs). Chaque config Playwright le lit, si bien
 * que les deux `playwright test` de `yarn test:e2e` sont bornés, pas seulement le dernier (ce que
 * ferait un `--workers` ajouté à la commande).
 *
 * - Sans la variable (absente ou vide) : la valeur actuelle de la config est conservée (CI comprise).
 * - Avec `E2E_WORKERS=n` : au plus `n`, jamais au-delà du plafond de la config.
 * - Une valeur invalide est une erreur, jamais ignorée en silence.
 */
type Env = Record<string, string | undefined>;

export function resolveE2EWorkers(
  current: number | undefined,
  env: Env = process.env,
): number | undefined {
  const raw = env.E2E_WORKERS?.trim();
  if (!raw) return current;
  const limit = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `E2E_WORKERS invalide : « ${raw} » (entier supérieur ou égal à 1 attendu)`,
    );
  }
  return current === undefined ? limit : Math.min(current, limit);
}
