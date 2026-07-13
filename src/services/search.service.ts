import { api } from "@/lib/api-client";
import type { Currency } from "@/lib/currency";
import type { SortOption } from "@/lib/validations/search";
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
 * d'hôtel inatteignable). Filtres & tri reflétés dans l'URL = story 1.8 (livrée). Un vrai pager
 * (jeux > 25) n'a de sens qu'à la livraison de l'endpoint agrégé PMS **D1** — différé jusque-là.
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
  /** Équipements disponibles (union des chambres) — source de facettes du filtre (FR-3). `[]` si aucun. */
  amenities: string[];
}

/** Critères datés + filtres/tri communs aux deux modes (FR-3, story 1.8). */
interface BaseSearchParams {
  /** Date-only `AAAA-MM-JJ`. */
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  currency: Currency;
  page?: number;
  pageSize?: number;
  /** Tri : `price_asc` | `price_desc` | `distance` (distance = no-op en mode destination). */
  sort?: SortOption;
  /** Fourchette de prix (cents entiers, sur le total du séjour). */
  minPrice?: number;
  maxPrice?: number;
  /** Capacité minimale (resserre la disponibilité au PMS). */
  minCapacity?: number;
  /** Catégories d'hôtel (multi-valeurs, OU logique). */
  category?: string[];
  /** Équipements de chambre (multi-valeurs, ET logique ; repli D9). */
  amenities?: string[];
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
  // Filtres & tri (FR-3) — communs aux deux modes. Doivent être déclarés au DTO BFF (sinon 400).
  appendFilters(query, params);
  if (params.page) {
    query.set("page", String(params.page));
  }
  // Défaut ≥ plafond fan-out : la page unique couvre tous les résultats bornés.
  query.set("pageSize", String(params.pageSize ?? SEARCH_RESULTS_PAGE_SIZE));
  return query.toString();
}

/** Émet les params filtre/tri (tableaux **répétés** : `category=a&category=b`). */
function appendFilters(
  query: URLSearchParams,
  params: SearchHotelsParams,
): void {
  if (params.sort) {
    query.set("sort", params.sort);
  }
  if (params.minPrice !== undefined) {
    query.set("minPrice", String(params.minPrice));
  }
  if (params.maxPrice !== undefined) {
    query.set("maxPrice", String(params.maxPrice));
  }
  if (params.minCapacity !== undefined) {
    query.set("minCapacity", String(params.minCapacity));
  }
  for (const value of params.category ?? []) {
    query.append("category", value);
  }
  for (const value of params.amenities ?? []) {
    query.append("amenities", value);
  }
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

/**
 * Construit l'URL **navigateur** de la page de résultats (`/search?…`), filtres/tri **reflétés**
 * (story 1.8, AC-3). Contrairement à `toQueryString` (destinée au BFF), elle **inclut** `mode=nearby`
 * pour que la page SSR (`parseSearchParams`) reconstruise la bonne vue au rechargement.
 */
export function buildResultsUrl(params: SearchHotelsParams): string {
  const query = new URLSearchParams();
  query.set("checkInDate", params.checkInDate);
  query.set("checkOutDate", params.checkOutDate);
  query.set("guests", String(params.guests));
  query.set("currency", params.currency);
  if (isNearbyParams(params)) {
    query.set("mode", "nearby");
    query.set("latitude", String(params.latitude));
    query.set("longitude", String(params.longitude));
    if (params.radiusKm !== undefined) {
      query.set("radiusKm", String(params.radiusKm));
    }
  } else {
    query.set("destination", params.destination);
  }
  appendFilters(query, params);
  return `/search?${query.toString()}`;
}

/**
 * Params de recherche **sans filtres ni pagination** — même contexte (mode/destination/coords/
 * dates/voyageurs/devise). Sert de source de **facettes** (options de filtre dérivées du jeu non
 * filtré, Décision 3) : sa clé React Query est stable quels que soient les filtres actifs.
 */
export function baseSearchParams(
  params: SearchHotelsParams,
): SearchHotelsParams {
  const shared = {
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: params.guests,
    currency: params.currency,
  };
  return isNearbyParams(params)
    ? {
        mode: "nearby",
        latitude: params.latitude,
        longitude: params.longitude,
        radiusKm: params.radiusKm,
        ...shared,
      }
    : { mode: "destination", destination: params.destination, ...shared };
}

/** Vrai si au moins un filtre (hors tri) est actif. */
export function hasActiveFilters(params: SearchHotelsParams): boolean {
  return (
    params.minPrice !== undefined ||
    params.maxPrice !== undefined ||
    params.minCapacity !== undefined ||
    (params.category?.length ?? 0) > 0 ||
    (params.amenities?.length ?? 0) > 0
  );
}
