import { api } from "@/lib/api-client";
import {
  bookingContextQuery,
  type ParsedBookingParams,
} from "@/lib/validations/booking";

/**
 * Service du domaine `booking` (story 2.2, FR-7) — **devis du récapitulatif avant paiement**.
 * Appelle **le BFF** (`GET /booking/quote`), jamais le PMS. Contrat miroir du `BookingQuoteDto`
 * du BFF : montants en **unités mineures entières de la devise de l'Hôtel** (l'exposant dépend de
 * la devise — cf. `lib/currency.ts#minorUnitExponent`), `null` jamais `undefined`, aucune
 * conversion de devise.
 *
 * Lecture seule : aucune réservation n'est créée à cette étape (story 2.4).
 */

/** Chemins **relatifs au BFF** (`API_BASE_URL` inclut déjà `/api/v1`). */
export const BOOKING_ENDPOINTS = {
  quote: "/booking/quote",
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
 * URL **navigateur** de l'étape de paiement (stories 2.4 / 3.1), contexte complet préservé.
 * La route existe dès la story 2.3 (placeholder borné) pour que le CTA d'identification ne soit
 * jamais un lien mort.
 */
export function buildPaymentUrl(params: ParsedBookingParams): string {
  return `/booking/payment?${bookingContextQuery(params)}`;
}

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
