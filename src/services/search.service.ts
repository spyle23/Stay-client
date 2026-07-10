import { api } from "@/lib/api-client";
import type { Currency } from "@/lib/currency";
import type { PaginatedResponse } from "@/types/api";

/**
 * Service de recherche multi-hôtels (FR-1/FR-2/FR-4). Appelle **le BFF**, jamais le PMS.
 * Deux modes partageant le **même** contrat de résultat (`HotelAvailabilityResult`) :
 * - **destination** → `GET /search/hotels` (story 1.6).
 * - **proximité** (`mode: "nearby"`) → `GET /search/hotels/nearby` (story 1.7 ; résultats triés
 *   par distance, chacun portant `distanceKm`).
 *
 * Le contrat est **figé** : il reste identique à la bascule fan-out → endpoint agrégé D1 côté BFF.
 * Montants en **cents entiers**.
 */
export const SEARCH_ENDPOINTS = {
  hotels: "/search/hotels",
  hotelsNearby: "/search/hotels/nearby",
} as const;

/**
 * Taille de page front — **≥ plafond de fan-out du BFF** (`SEARCH_FANOUT_MAX_HOTELS=25`) : une
 * seule page montre tous les résultats bornés, donc le compte affiché == cartes rendues (pas
 * d'hôtel inatteignable). La vraie pagination (filtres/tri reflétés dans l'URL) arrive en story 1.8.
 */
export const SEARCH_RESULTS_PAGE_SIZE = 25;

/** Résultat par hôtel — miroir du DTO de sortie du BFF (montants en unités mineures/cents). */
export interface HotelAvailabilityResult {
  hotelId: string;
  name: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
  currency: string;
  fromPricePerNight: number;
  fromTotalPrice: number;
  nights: number;
  availableRoomCount: number;
  thumbnailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Distance (km) depuis la position — peuplée en mode proximité uniquement, sinon `null`. */
  distanceKm: number | null;
}

/** Critères datés communs aux deux modes. */
interface BaseSearchParams {
  /** Date-only `AAAA-MM-JJ`. */
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  currency: Currency;
  page?: number;
  pageSize?: number;
}

export interface DestinationSearchParams extends BaseSearchParams {
  mode?: "destination";
  destination: string;
}

export interface NearbySearchParams extends BaseSearchParams {
  mode: "nearby";
  latitude: number;
  longitude: number;
  radiusKm?: number;
}

export type SearchHotelsParams = DestinationSearchParams | NearbySearchParams;

export function isNearbyParams(
  params: SearchHotelsParams,
): params is NearbySearchParams {
  return params.mode === "nearby";
}

/** Convention de clés React Query (réutilisée par 1.7/1.8). */
export const searchKeys = {
  all: ["search"] as const,
  hotels: (params: SearchHotelsParams) => ["search", "hotels", params] as const,
};

function toQueryString(params: SearchHotelsParams): string {
  const query = new URLSearchParams();
  query.set("checkInDate", params.checkInDate);
  query.set("checkOutDate", params.checkOutDate);
  query.set("guests", String(params.guests));
  query.set("currency", params.currency);
  if (isNearbyParams(params)) {
    // `mode` est un discriminateur d'URL FRONT uniquement : le BFF distingue déjà la proximité
    // par le chemin `/search/hotels/nearby`. Ne PAS l'émettre — le DTO du BFF rejette tout param
    // hors liste (`forbidNonWhitelisted`) → 400.
    query.set("latitude", String(params.latitude));
    query.set("longitude", String(params.longitude));
    if (params.radiusKm !== undefined) {
      query.set("radiusKm", String(params.radiusKm));
    }
  } else {
    query.set("destination", params.destination);
  }
  if (params.page) {
    query.set("page", String(params.page));
  }
  // Défaut ≥ plafond fan-out : la page unique couvre tous les résultats bornés.
  query.set("pageSize", String(params.pageSize ?? SEARCH_RESULTS_PAGE_SIZE));
  return query.toString();
}

export function fetchHotelSearch(
  params: SearchHotelsParams,
): Promise<PaginatedResponse<HotelAvailabilityResult>> {
  const endpoint = isNearbyParams(params)
    ? SEARCH_ENDPOINTS.hotelsNearby
    : SEARCH_ENDPOINTS.hotels;
  return api.getList<HotelAvailabilityResult>(
    `${endpoint}?${toQueryString(params)}`,
  );
}
