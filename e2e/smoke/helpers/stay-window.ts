/**
 * Fenêtres de séjour du smoke de réservation (`booking-payment.smoke.spec.ts`, #146).
 *
 * Le smoke crée de **vraies** réservations, et le jeu de référence n'a qu'une chambre par hôtel :
 * une `Pending` immobilise réellement la chambre (le PMS n'exclut que les `Cancelled` du
 * chevauchement), et dès que l'écran de paiement a demandé son intent, le balayeur ne la libère
 * plus. Chaque scénario doit donc viser un séjour qu'aucun passage récent n'a réservé.
 *
 * ⚠️ Pourquoi la minute ne suffisait pas (#146) : l'ancien décalage ne changeait qu'à chaque
 * minute. Deux passages dans la même minute (`--repeat-each 3`, deux `smoke-baseline.mjs run`
 * successifs) visaient le même séjour. Or le BFF met en cache la recherche (45 s) et la fiche
 * hôtel (60 s) : le second passage voyait encore la chambre « disponible », et le PMS refusait la
 * réservation (`payment-reservation-code` absent, « Cette chambre vient d'être réservée »).
 *
 * Le décalage change désormais **à chaque seconde** : deux passages d'un même scénario (au moins
 * une seconde d'écart, un passage durant plusieurs secondes) n'ont jamais le même séjour avant un
 * cycle complet de `CYCLE_SECONDS`, plus long que les caches du BFF. Au-delà, un séjour peut
 * revenir, mais le cache a expiré : la recherche n'affiche plus l'hôtel déjà réservé, et le
 * parcours ouvre l'hôtel suivant.
 */

/** Durée d'un séjour du smoke (nuits). */
export const STAY_NIGHTS = 2;

/** Écart entre deux séjours voisins (jours) : plus que `STAY_NIGHTS`, jamais de recouvrement. */
export const STEP_DAYS = 3;

/** Premier jour des séjours non payants, après ceux des autres specs (J+30 à J+33). */
export const FIRST_DAY = 60;

/**
 * Scénarios non payants : 0 création · 1 idempotence · 2 divergence · 3 préférences (2.5) ·
 * 4 upsell (2.6).
 */
export const STAY_SLOTS = 5;

/**
 * Plus longue durée par défaut des caches du BFF (secondes) : `CATALOG_CACHE_TTL_SECONDS` (60) ;
 * `SEARCH_CACHE_TTL_SECONDS` vaut 45.
 */
export const CACHE_TTL_SECONDS = 60;

/** Période après laquelle un séjour revient (secondes), plus longue que les caches du BFF. */
export const CYCLE_SECONDS = 90;

/** Premier jour de la bande payante, après tous les séjours non payants. */
export const PAID_FIRST_DAY = 1_500;

/** Largeur de la bande de chaque scénario payant (jours). */
export const PAID_SLOT_BAND_DAYS = 300;

/**
 * Décalage (jours depuis aujourd'hui) du séjour d'un scénario non payant, propre à ce passage.
 *
 * Les scénarios sont entrelacés : à la seconde `s` du cycle, le scénario `slot` occupe la position
 * `s × STAY_SLOTS + slot`. Aucun séjour ne recoupe donc celui d'un autre scénario, ni celui d'un
 * passage du même scénario dans le même cycle.
 */
export function uniqueStayOffset(slot: number, nowMs = Date.now()): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= STAY_SLOTS) {
    throw new RangeError(
      `Scénario ${slot} hors des bandes du smoke (0 à ${STAY_SLOTS - 1}).`,
    );
  }
  const second = Math.floor(nowMs / 1_000) % CYCLE_SECONDS;
  return FIRST_DAY + (second * STAY_SLOTS + slot) * STEP_DAYS;
}

/**
 * Décalage du séjour d'un scénario de **paiement** (vrai Stripe), neuf à chaque exécution.
 *
 * Ces scénarios consomment l'inventaire pour toute la vie de la base : l'autorisation posée, la
 * `Pending` n'est plus jamais annulée (story 3.3). Chacun reçoit sa propre bande, disjointe de
 * l'autre (ils tournent l'un après l'autre sur la même chambre) et des scénarios non payants. La
 * part aléatoire évite de retomber sur la fenêtre d'une exécution précédente.
 */
export function paidStayOffset(slot: number, random = Math.random): number {
  return (
    PAID_FIRST_DAY +
    slot * PAID_SLOT_BAND_DAYS +
    Math.floor(random() * (PAID_SLOT_BAND_DAYS - STEP_DAYS - STAY_NIGHTS))
  );
}
