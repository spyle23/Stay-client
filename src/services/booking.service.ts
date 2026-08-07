import type { Locale } from "@/i18n/config";
import { api, ApiClientError } from "@/lib/api-client";
import {
  bookingContextQuery,
  normalizeSpecialRequests,
  type BookingPreferences,
  type ParsedBookingParams,
} from "@/lib/validations/booking";

/**
 * Service du domaine `booking`. Appelle **le BFF**, jamais le PMS. Contrat miroir des DTO du BFF :
 * montants en **unités mineures entières de la devise de l'Hôtel** (l'exposant dépend de la devise
 * — cf. `lib/currency.ts#minorUnitExponent`), `null` jamais `undefined`, aucune conversion.
 *
 * - Story 2.2 (FR-7) : `fetchBookingQuote` — devis du récapitulatif avant paiement, en lecture.
 * - Story 2.4 (FR-9) : `createReservation` / `fetchReservation` — création de la Réservation
 *   `Pending` et reprise du tunnel. Le paiement lui-même reste le périmètre de l'Epic 3.
 */

/** Chemins **relatifs au BFF** (`API_BASE_URL` inclut déjà `/api/v1`). */
export const BOOKING_ENDPOINTS = {
  quote: "/booking/quote",
  reservations: "/booking/reservations",
} as const;

/** État de la taxe — `included_undetailed` tant que D7 n'alimente pas la taxe côté PMS. */
export type TaxState = "included_undetailed";

/** Politique d'annulation (miroir `CancellationPolicyDto`). `source: "fallback"` = D2 non livré. */
export interface CancellationPolicyResult {
  source: "hotel" | "fallback";
  refundable: boolean | null;
  freeUntil: string | null;
  terms: string | null;
}

/** Devis de réservation (miroir `BookingQuoteDto` du BFF). */
export interface BookingQuoteResult {
  hotelId: string;
  hotelName: string | null;
  hotelCity: string | null;
  hotelLogoUrl: string | null;
  roomId: string;
  roomNumber: string | null;
  roomCategory: string | null;
  roomCapacity: number | null;
  roomImageUrl: string | null;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guests: number;
  /** Devise de l'**Hôtel** (jamais la devise de travail, jamais convertie). */
  currency: string;
  pricePerNight: number;
  roomTotal: number;
  /** Toujours `null` tant que D7 n'est pas livré (jamais un montant de taxe inventé). */
  taxAmount: null;
  taxState: TaxState;
  /** Total à payer = montant qui sera débité (anti drip-pricing). */
  total: number;
  available: boolean;
  /** Disponibilité datée indéterminée (panne PMS) — jamais présenté comme « indisponible ». */
  availabilityDegraded: boolean;
  cancellationPolicy: CancellationPolicyResult;
  quotedAt: string;
}

/** Convention de clés React Query (patron `catalogKeys`/`authKeys`). */
export const bookingKeys = {
  all: ["booking"] as const,
  quote: (params: ParsedBookingParams) =>
    [
      "booking",
      "quote",
      params.hotelId,
      params.roomId,
      params.checkInDate,
      params.checkOutDate,
      params.guests,
    ] as const,
};

/**
 * Émet **exactement** les cinq paramètres déclarés au DTO du BFF. La devise de travail reste dans
 * l'URL navigateur mais n'est **jamais** envoyée : tout param non déclaré est rejeté en 400 par le
 * `ValidationPipe` global (`forbidNonWhitelisted`) — cf. bug Phase 3 de 1.7.
 */
function toQueryString(params: ParsedBookingParams): string {
  return new URLSearchParams({
    hotelId: params.hotelId,
    roomId: params.roomId,
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: String(params.guests),
  }).toString();
}

/** Récupère le devis du récapitulatif pour (hôtel, chambre, dates, voyageurs). */
export function fetchBookingQuote(
  params: ParsedBookingParams,
): Promise<BookingQuoteResult> {
  return api.get<BookingQuoteResult>(
    `${BOOKING_ENDPOINTS.quote}?${toQueryString(params)}`,
  );
}

/** URL **navigateur** de l'étape récapitulatif, contexte complet préservé. */
export function buildRecapUrl(params: ParsedBookingParams): string {
  return `/booking/recap?${bookingContextQuery(params)}`;
}

/**
 * URL **navigateur** de l'étape d'identification (story 2.3), contexte complet préservé —
 * le tunnel ne doit jamais forcer une re-saisie (UX-DR-4.4).
 */
export function buildIdentifyUrl(params: ParsedBookingParams): string {
  return `/booking/identify?${bookingContextQuery(params)}`;
}

/**
 * URL **navigateur** de l'étape de paiement, contexte complet préservé.
 *
 * `reservationId` est ajouté **après** création (story 2.4) : c'est lui qui rend la reprise
 * possible — un rafraîchissement relit la réservation au lieu d'en créer une seconde (UX-DR-4.7).
 * Ce n'est pas un secret : la route est gardée par la session **et** le PMS vérifie la propriété.
 */
export function buildPaymentUrl(
  params: ParsedBookingParams,
  reservationId?: string,
): string {
  const query = bookingContextQuery(params);
  return reservationId
    ? `/booking/payment?${query}&reservationId=${encodeURIComponent(reservationId)}`
    : `/booking/payment?${query}`;
}

/** Statuts de réservation exposés par le BFF (miroir de `ReservationStatusName`). */
export type ReservationStatus =
  | "Pending"
  | "Confirmed"
  | "CheckedIn"
  | "CheckedOut"
  | "Cancelled"
  | "NoShow"
  | "Unknown";

/** Réservation du tunnel (miroir `BookingReservationDto` du BFF). Aucune PII du client. */
export interface BookingReservationResult {
  reservationId: string;
  /** Code lisible généré par le PMS (`RES-AAAAMMJJ-XXXXX`). */
  reservationCode: string;
  status: ReservationStatus;
  hotelId: string;
  hotelName: string | null;
  roomId: string;
  roomNumber: string | null;
  roomCategory: string | null;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guests: number;
  currency: string;
  pricePerNight: number;
  total: number;
  /** Échéance du Hold de checkout (ISO 8601 UTC), ou `null` si le hold a expiré. */
  holdExpiresAt: string | null;
  /**
   * Demandes spéciales **réellement attachées** à la réservation, relues du PMS par le BFF.
   *
   * ⚠️ Sur un rejeu idempotent, c'est le texte de la **première** soumission — pas celui que
   * l'écran vient d'envoyer. Le PMS n'expose aucune route de mise à jour au voyageur : ce qui est
   * attaché l'est définitivement (story 2.5, AC-6).
   */
  specialRequests: string | null;
  /** Langue de communication choisie, mémorisée par le BFF ; `null` si inconnue. */
  communicationLocale: Locale | null;
  /**
   * Ce que le système fait **réellement** de la langue choisie. `hotel_default_fallback` tant que
   * la dépendance PMS D10 n'est pas livrée — l'écran doit alors le dire, jamais promettre l'inverse.
   */
  communicationLocaleState: "applied" | "hotel_default_fallback";
  /** `true` si cet appel a réellement créé la réservation ; `false` sur rejeu idempotent. */
  created: boolean;
}

/** Convention de clés React Query pour les réservations du tunnel. */
export const reservationKeys = {
  all: ["booking", "reservation"] as const,
  byId: (id: string) => ["booking", "reservation", id] as const,
};

/**
 * Motif machine d'un échec de création, tel que posé par le BFF dans `errors.reason`.
 * Chaque valeur commande une **issue différente** à l'écran (voir `booking-payment.tsx`).
 */
export type ReservationFailureReason =
  | "room-unavailable"
  | "over-capacity"
  | "invalid-dates"
  | "room-not-found"
  | "session-invalid"
  | "price-changed"
  /** Refus **déterministe non qualifié** : le BFF y range tout 4xx PMS qu'il n'a pas su classer. */
  | "rejected"
  | "rate-limited"
  | "unavailable"
  | "unknown";

/**
 * Traduit une erreur d'API en motif exploitable.
 *
 * Deux motifs viennent du **statut** et non du corps : `rate-limited` (429, produit par le
 * limiteur, sans code machine) et `session-invalid` (401 — l'`api-client` remplace le corps d'un
 * 401 par une erreur générique, aucun motif n'y survivrait).
 */
export function reservationFailureReason(
  error: unknown,
): ReservationFailureReason {
  if (!(error instanceof ApiClientError)) {
    return "unknown";
  }
  if (error.status === 401) {
    return "session-invalid";
  }
  if (error.status === 429) {
    return "rate-limited";
  }
  if (error.status === 503) {
    return "unavailable";
  }
  const reason = error.errors?.reason?.[0];
  return isFailureReason(reason) ? reason : "unknown";
}

/**
 * Motifs que le BFF sait poser dans `errors.reason` (miroir de `BookingFailureReason`).
 *
 * ⚠️ `rejected` en fait partie : le contrat du BFF déclare `400 invalid-dates | rejected`, et
 * `booking-errors.ts` y range **tout 4xx PMS non classé**. L'omettre le faisait retomber en
 * `unknown` — le seul motif, avec `unavailable`, à recevoir un bouton « Réessayer » — alors que
 * c'est un refus **déterministe** que le rejeu à l'identique ne peut que reproduire.
 */
const KNOWN_REASONS: readonly ReservationFailureReason[] = [
  "room-unavailable",
  "over-capacity",
  "invalid-dates",
  "room-not-found",
  "session-invalid",
  "price-changed",
  "rejected",
];

function isFailureReason(
  value: string | undefined,
): value is ReservationFailureReason {
  return (
    value !== undefined &&
    KNOWN_REASONS.includes(value as ReservationFailureReason)
  );
}

/**
 * Nouveau total transporté par un échec `price-changed` (unités mineures + devise).
 *
 * Le BFF le fait passer par `errors` faute d'autre canal : le filtre d'exceptions ne conserve que
 * `message` et `errors`. L'écran doit l'afficher et faire **re-confirmer explicitement** — jamais
 * réessayer en silence sur un montant que le voyageur n'a pas vu (UX-DR-9.2).
 *
 * La validation est **stricte**, et pas seulement défensive : le montant renvoyé ici part droit
 * dans `formatCurrency`, qui **lève** sur un non-entier (`lib/utils.ts`), sur un écran sans error
 * boundary et à l'instant le plus critique du tunnel. `Number.isFinite` laissait passer :
 *
 * - `"170.5"` → exception en plein rendu ;
 * - `"1e21"`  → `1e+21 €`, un montant que personne ne re-confirmera jamais ;
 * - `"-1"`    → un « total à payer » négatif ;
 * - `""`      → `Number("") === 0`, donc « le total est désormais de 0 € » : **un montant inventé**,
 *   exactement ce que ce chemin doit rendre impossible.
 *
 * En cas de doute : `null`. L'écran retombe alors sur le message générique `price-changed`, sans
 * bouton de re-confirmation — un cul-de-sac honnête vaut mieux qu'un montant faux.
 */
export function priceChangeFrom(
  error: unknown,
): { total: number; currency: string } | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }
  const rawTotal = error.errors?.total?.[0];
  const currency = error.errors?.currency?.[0];
  if (
    rawTotal === undefined ||
    rawTotal.trim() === "" ||
    currency === undefined ||
    currency.trim() === ""
  ) {
    return null;
  }
  const total = Number(rawTotal);
  // Unités mineures ⇒ entier **sûr** (au-delà de 2^53 la valeur n'est plus exacte) et ≥ 0.
  if (!Number.isSafeInteger(total) || total < 0) {
    return null;
  }
  return { total, currency };
}

/** Ce que le voyageur a vu à l'écran — opposé par le BFF au total que le PMS persiste (AC-2). */
export interface ExpectedPrice {
  total: number;
  currency: string;
}

/**
 * Crée la Réservation `Pending`.
 *
 * `expectedTotal`/`expectedCurrency` proviennent **du devis affiché**, jamais d'un recalcul local :
 * c'est précisément le montant montré au voyageur que le BFF doit opposer au PMS.
 */
export function createReservation(
  params: ParsedBookingParams,
  expected: ExpectedPrice,
  preferences?: BookingPreferences,
): Promise<BookingReservationResult> {
  // Normalisée comme le fera le BFF : ce qui part est exactement ce qui sera stocké, donc ce qui
  // sera relu. Sans cela, la comparaison de divergence portait sur deux formes différentes (F5).
  const specialRequests = preferences
    ? normalizeSpecialRequests(preferences.specialRequests)
    : "";
  return api.post<BookingReservationResult>(BOOKING_ENDPOINTS.reservations, {
    hotelId: params.hotelId,
    roomId: params.roomId,
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: params.guests,
    expectedTotal: expected.total,
    expectedCurrency: expected.currency,
    // Clés **omises** plutôt qu'envoyées vides : le BFF distingue « pas de demande » de « demande
    // vide », et une clé à `""` produirait une demande spéciale vide côté PMS.
    ...(specialRequests.length > 0 ? { specialRequests } : {}),
    // La langue ne part que si elle a été **choisie** (revue 2ᵉ passe, F6) : un sélecteur jamais
    // touché n'exprime pas une préférence, et l'envoyer quand même rendait l'état « aucun choix »
    // inatteignable — contredisant le contrat que le DTO de sortie énonce.
    ...(preferences?.localeTouched
      ? { communicationLocale: preferences.communicationLocale }
      : {}),
  });
}

/** Relit une réservation du tunnel (reprise après rafraîchissement ou retour arrière). */
export function fetchReservation(
  reservationId: string,
): Promise<BookingReservationResult> {
  return api.get<BookingReservationResult>(
    `${BOOKING_ENDPOINTS.reservations}/${encodeURIComponent(reservationId)}`,
  );
}

// ⚠️ `isHoldActive` a été **supprimé** (revue 2.4). C'était du code mort : seul son propre spec
// l'importait, et l'écran de paiement porte sa propre garde (`useHoldStatus` + `formatHoldDeadline`,
// dans `booking-payment.tsx`), qui lit l'échéance via un minuteur plutôt que l'horloge du rendu.
// Ses tests donnaient une assurance de façade sur une fonction que personne ne rendait — ne pas
// la réintroduire sans consommateur réel.

/**
 * Le séjour demande **plus de voyageurs que la chambre n'en accueille**.
 *
 * Cause **déterministe**, connue du devis lui-même — à distinguer d'une indisponibilité (la
 * chambre est prise) et d'une incertitude PMS (cross-check en panne). Quand elle est vraie, elle
 * **prime** sur les deux autres messages : le PMS sort de toute façon la chambre de son set daté,
 * et afficher « elle n'est plus disponible » à côté de « trop de voyageurs » ferait cohabiter une
 * cause vague et la cause réelle (constaté en Phase 3, revue 2.2).
 */
export function isOverCapacity(quote: BookingQuoteResult): boolean {
  return quote.roomCapacity !== null && quote.guests > quote.roomCapacity;
}
