import type { Locale } from "@/i18n/config";
import { apiRequest, ApiClientError } from "@/lib/api-client";
import type {
  ReservationServiceResult,
  ReservationStatus,
} from "@/services/booking.service";

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
  /** Story 3.2 — confirmation ferme (capture + `Pending → Confirmed` côté PMS) et preuve. */
  confirm: (reservationId: string) =>
    `/payment/reservations/${encodeURIComponent(reservationId)}/confirm`,
} as const;

export const paymentKeys = {
  all: ["payment"] as const,
  intent: (reservationId: string) =>
    ["payment", "intent", reservationId.toLowerCase()] as const,
  /** Clé de MUTATION de la confirmation : l'état survit aux montages (voir `use-confirm-reservation`). */
  confirm: (reservationId: string) =>
    ["payment", "confirm", reservationId.toLowerCase()] as const,
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

// --- Confirmation ferme post-paiement (story 3.2) -------------------------------------------

/**
 * Preuve de confirmation — miroir **exact** du `ConfirmationProofDto` du BFF. Aucune donnée
 * personnelle, aucun jeton de check-in (seule son image QR est servie, à part).
 */
export interface ConfirmationProofResult {
  reservationId: string;
  reservationCode: string;
  status: ReservationStatus;
  hotelName: string | null;
  roomNumber: string | null;
  roomCategory: string | null;
  /** Date-only `AAAA-MM-JJ`. */
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guests: number;
  currency: string;
  /** Unités mineures entières de `currency`. */
  total: number;
  roomTotal: number;
  servicesTotal: number;
  services: ReservationServiceResult[];
  /**
   * Montant réellement encaissé, relu du PMS (unités mineures) ; `null` quand cet appel ne l'a pas
   * relu (réservation déjà confirmée). L'écran affiche alors `total`, que le PMS garantit égal au
   * capturé : il refuse de confirmer quand l'autorisé diverge du dû.
   */
  capturedAmount: number | null;
  communicationLocale: Locale | null;
  /** `hotel_default_fallback` tant que la dépendance PMS D10 n'est pas livrée. */
  communicationLocaleState: "applied" | "hotel_default_fallback";
  /** `true` si la réservation était déjà confirmée avant cet appel (rechargement, autre onglet). */
  alreadyConfirmed: boolean;
}

/**
 * Motif machine d'un échec de confirmation (`errors.reason` du BFF), plus `unavailable` (503) et
 * `unknown`. Chaque valeur commande une issue différente — aucune n'est un cul-de-sac.
 */
export type ConfirmFailureReason =
  | "payment-not-authorized"
  | "amount-mismatch"
  | "capture-failed"
  | "authorisation-expired"
  | "reservation-not-found"
  | "reservation-cancelled"
  | "room-unavailable"
  | "not-owner"
  | "session-invalid"
  | "rejected"
  | "unavailable"
  | "unknown";

/**
 * Statut de débit d'un échec de confirmation (#4, AC-8), lu par le BFF au PMS (`errors.debit`) :
 * `none` (aucun débit conservé), `refunded` (remboursement intégral émis), `captured` (montant
 * encaissé sur une réservation annulée, sans remboursement). `null` quand le BFF ne l'a pas établi.
 */
export type ConfirmDebitStatus = "none" | "refunded" | "captured";

const KNOWN_DEBITS: ReadonlySet<string> = new Set<ConfirmDebitStatus>([
  "none",
  "refunded",
  "captured",
]);

/** Statut de débit porté par un échec de confirmation, ou `null` s'il est absent ou inconnu. */
export function confirmFailureDebit(error: unknown): ConfirmDebitStatus | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }
  const debit = error.errors?.debit?.[0];
  return debit && KNOWN_DEBITS.has(debit)
    ? (debit as ConfirmDebitStatus)
    : null;
}

/**
 * Confirme la réservation et rend la preuve. Idempotent côté BFF et PMS : un rejeu (rechargement,
 * second onglet) rend la même preuve, jamais une seconde capture.
 */
export async function confirmReservation(
  reservationId: string,
): Promise<ConfirmationProofResult> {
  return apiRequest<ConfirmationProofResult>(
    PAYMENT_ENDPOINTS.confirm(reservationId),
    { method: "POST" },
  );
}

const KNOWN_CONFIRM_REASONS: ReadonlySet<string> =
  new Set<ConfirmFailureReason>([
    "payment-not-authorized",
    "amount-mismatch",
    "capture-failed",
    "authorisation-expired",
    "reservation-not-found",
    "reservation-cancelled",
    "room-unavailable",
    "not-owner",
    "session-invalid",
    "rejected",
  ]);

/**
 * Traduit un échec de confirmation en motif exploitable par l'écran. Le motif se lit dans
 * `errors.reason`, jamais dans le message (destiné à l'affichage, il changera).
 */
export function confirmFailureReason(error: unknown): ConfirmFailureReason {
  if (!(error instanceof ApiClientError)) {
    return "unknown";
  }
  const reason = error.errors?.reason?.[0];
  if (reason && KNOWN_CONFIRM_REASONS.has(reason)) {
    return reason as ConfirmFailureReason;
  }
  if (error.status === 503) {
    return "unavailable";
  }
  if (error.status === 401) {
    return "session-invalid";
  }
  return "unknown";
}

/**
 * Motifs pour lesquels **réessayer à l'identique** peut aboutir : une indisponibilité, une erreur
 * inattendue, ou une capture que Stripe n'a pas pu faire (la confirmation est idempotente). Tout le
 * reste est déterministe.
 */
export const RETRYABLE_CONFIRM_REASONS: ReadonlySet<ConfirmFailureReason> =
  new Set<ConfirmFailureReason>(["unavailable", "unknown", "capture-failed"]);
