// Validation partagée du tunnel de réservation (story 2.2, FR-7) — pure et testable.
//
// Le contexte du tunnel (hôtel, chambre, dates, voyageurs, devise) vit **dans l'URL** : deep-link
// depuis la fiche chambre, partageable, rechargeable, survivant au retour arrière (UX-DR-4.7).
// Il n'y a donc **aucun état de tunnel serveur** à cette étape — l'état Redis n'apparaît qu'en
// story 2.4, quand il faudra porter l'id de la Réservation `Pending` et le Hold de checkout.
//
// Règles de dates/voyageurs **importées** de `validations/search.ts` (source unique, alignée sur
// les DTO du BFF) : les redupliquer ferait diverger front et BFF au premier ajustement.

import { defaultCurrency, isCurrency, type Currency } from "@/lib/currency";
import {
  validateDatesGuests,
  type SearchValidationError,
} from "@/lib/validations/search";

/** GUID (hex 8-4-4-4-12) complet — `hotelId`/`roomId` sont des GUID nus dans l'URL du tunnel. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Codes d'erreur i18n (traduits par l'appelant via le namespace `booking`). Réutilise les codes de
 * `search` pour dates/voyageurs et ajoute les identifiants propres au tunnel.
 */
export type BookingValidationError = SearchValidationError | "roomRequired";

export interface ParsedBookingParams {
  hotelId: string;
  roomId: string;
  /** Date-only `AAAA-MM-JJ` — garanties valides, ordonnées et non passées. */
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  /** Devise de travail portée par l'URL (contexte) ; jamais envoyée au BFF. */
  currency: Currency;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** GUID normalisé en minuscules, ou `null` si la valeur n'en est pas un. */
export function parseGuid(value: string | undefined): string | null {
  return value !== undefined && GUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Parse + valide les query-params du tunnel. Un résultat invalide n'entraîne **aucun** appel BFF
 * (la page rend un état d'invalidité avec une porte de sortie — jamais un 400 brut ni un 500).
 *
 * Contrairement à la page hôtel/chambre (qui retombe sur un affichage prix/nuit sans dates), un
 * **devis sans dates n'existe pas** : les dates sont donc obligatoires ici.
 */
export function parseBookingParams(
  searchParams: Record<string, string | string[] | undefined>,
):
  | { ok: true; value: ParsedBookingParams }
  | { ok: false; errors: BookingValidationError[] } {
  const hotelId = parseGuid(firstValue(searchParams.hotelId));
  const roomId = parseGuid(firstValue(searchParams.roomId));
  const checkInDate = firstValue(searchParams.checkInDate) ?? null;
  const checkOutDate = firstValue(searchParams.checkOutDate) ?? null;
  const guestsRaw = firstValue(searchParams.guests);
  // Voyageurs absents → 1 par défaut (le lien de la fiche chambre peut ne pas les porter) ;
  // une valeur présente mais aberrante reste une erreur (URL éditée à la main).
  const guests = guestsRaw === undefined ? 1 : Number(guestsRaw);
  const currencyRaw = firstValue(searchParams.currency);
  const currency: Currency = isCurrency(currencyRaw)
    ? currencyRaw
    : defaultCurrency;

  const errors: BookingValidationError[] = [];
  if (hotelId === null || roomId === null) {
    errors.push("roomRequired");
  }
  errors.push(...validateDatesGuests({ checkInDate, checkOutDate, guests }));

  if (
    errors.length > 0 ||
    hotelId === null ||
    roomId === null ||
    checkInDate === null ||
    checkOutDate === null
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["roomRequired"] };
  }

  return {
    ok: true,
    value: { hotelId, roomId, checkInDate, checkOutDate, guests, currency },
  };
}

/**
 * Sérialise le contexte du tunnel en query-string **navigateur** (toutes les clés, devise
 * comprise). Utilisé par la redirection `/booking` → `/booking/recap`, par l'éditeur de séjour et
 * par le passage à l'étape d'identification : le contexte ne doit jamais se perdre en route.
 */
export function bookingContextQuery(params: ParsedBookingParams): string {
  const query = new URLSearchParams({
    hotelId: params.hotelId,
    roomId: params.roomId,
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: String(params.guests),
    currency: params.currency,
  });
  return query.toString();
}
