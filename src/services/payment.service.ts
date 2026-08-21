import { apiRequest, ApiClientError } from "@/lib/api-client";

/**
 * Frontière du domaine **paiement** côté navigateur (story 3.1, FR-12).
 *
 * Le front ne parle **qu'au BFF** — à une exception près, prévue par l'architecture : **Stripe**,
 * joint directement par le Payment Element pour que les données de carte ne traversent jamais nos
 * serveurs (PCI SAQ-A). Aucune clé secrète, aucun appel au PMS depuis ici.
 */

export const PAYMENT_ENDPOINTS = {
  intent: (reservationId: string) =>
    `/payment/reservations/${encodeURIComponent(reservationId)}/intent`,
} as const;

export const paymentKeys = {
  all: ["payment"] as const,
  intent: (reservationId: string) =>
    ["payment", "intent", reservationId.toLowerCase()] as const,
};

/**
 * Miroir **exact** du `PaymentIntentDto` du BFF. Toute divergence se verrait au type-check plutôt
 * qu'à l'exécution.
 */
export interface PaymentIntentResult {
  clientSecret: string;
  publishableKey: string;
  paymentIntentId: string;
  /** Unités mineures entières de `currency` — jamais un flottant, jamais un « euro ». */
  amount: number;
  currency: string;
  /**
   * `'manual'` = fonds seulement **retenus** (capture manuelle, D8). C'est cette valeur — et non une
   * constante écrite en dur — qui autorise l'écran à promettre « aucun débit ferme conservé ».
   */
  captureMethod: "manual" | "automatic";
}

/**
 * Motif machine d'un échec, tel que posé par le BFF dans `errors.reason`.
 * Chaque valeur commande une **issue différente** à l'écran.
 */
export type PaymentFailureReason =
  | "already-authorized"
  | "amount-mismatch"
  | "currency-unsupported"
  | "reservation-not-found"
  | "reservation-not-pending"
  | "not-owner"
  | "session-invalid"
  | "rejected"
  | "unavailable"
  | "unknown";

/**
 * Demande le PaymentIntent de la réservation.
 *
 * **`POST` malgré l'apparence d'une lecture** : l'appel a des effets serveur (il gèle le balayeur
 * de holds et fait émettre un PaymentIntent).
 *
 * ⚠️ Il est pourtant consommé par une **requête** React Query, pas une mutation : l'appel est
 * idempotent côté PMS (l'intent existant est réutilisé), et une requête est dédoublonnée par sa
 * clé de cache — ce qu'une mutation ne fait pas. Voir `use-payment-intent.ts`, qui documente le
 * défaut de montage qui a motivé ce choix. Ne pas revenir à une mutation sans le relire.
 */
export async function createPaymentIntent(
  reservationId: string,
): Promise<PaymentIntentResult> {
  return apiRequest<PaymentIntentResult>(
    PAYMENT_ENDPOINTS.intent(reservationId),
    {
      method: "POST",
    },
  );
}

/**
 * Traduit un échec en motif exploitable par l'écran.
 *
 * ⚠️ Le motif se lit dans `errors.reason`, **jamais** dans le message : le texte est destiné à
 * l'affichage et changera ; le code ne doit pas en dépendre (règle établie en 2.3/2.4).
 */
export function paymentFailureReason(error: unknown): PaymentFailureReason {
  if (!(error instanceof ApiClientError)) {
    return "unknown";
  }

  const reason = error.errors?.reason?.[0];
  if (reason && isKnownReason(reason)) {
    return reason;
  }

  // 503 : le BFF, Redis ou le PMS est injoignable. « Réessayer » a un sens ici, et seulement ici.
  if (error.status === 503) {
    return "unavailable";
  }
  if (error.status === 401) {
    return "session-invalid";
  }
  return "unknown";
}

const KNOWN_REASONS: ReadonlySet<string> = new Set<PaymentFailureReason>([
  "already-authorized",
  "amount-mismatch",
  "currency-unsupported",
  "reservation-not-found",
  "reservation-not-pending",
  "not-owner",
  "session-invalid",
  "rejected",
]);

function isKnownReason(value: string): value is PaymentFailureReason {
  return KNOWN_REASONS.has(value);
}

/**
 * Motifs pour lesquels **réessayer à l'identique** peut aboutir.
 *
 * Tout le reste est déterministe : proposer « Réessayer » y produirait le cul-de-sac que la story
 * 2.4 avait déjà eu à corriger.
 */
export const RETRYABLE_PAYMENT_REASONS: ReadonlySet<PaymentFailureReason> =
  new Set<PaymentFailureReason>(["unavailable", "unknown", "rejected"]);
