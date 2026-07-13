// Validation partagée de la recherche (FR-1/FR-2) — pure et testable, réutilisée par la
// `SearchBar` (rejet client AVANT navigation/appel BFF) et par la page de résultats
// (parse des query-params). Règles alignées sur les DTO du BFF : départ > arrivée,
// arrivée non passée (référentiel UTC), voyageurs ≥ 1 ; coordonnées dans les bornes.

import { defaultCurrency, isCurrency, type Currency } from "@/lib/currency";

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Bornes voyageurs — source unique (le BFF applique `@Min(1)`/`@Max(30)`). Réutilisées par
// `GuestSelector`. Vérifiées ici pour rejeter une URL éditée (`?guests=99`) côté client.
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 30;

/** Parse une date-only `AAAA-MM-JJ` en timestamp UTC minuit, ou `null` si invalide. */
export function parseDateOnlyUtc(value: string): number | null {
  if (!DATE_ONLY.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const ts = Date.UTC(year, month - 1, day);
  const date = new Date(ts);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

export function todayUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Codes d'erreur i18n (traduits par l'appelant via le namespace `search`). */
export type SearchValidationError =
  | "destinationRequired"
  | "datesRequired"
  | "checkInPast"
  | "checkOutBeforeCheckIn"
  | "guestsMin"
  | "guestsMax"
  | "coordsRequired"
  | "coordsInvalid";

export interface RawDatesGuests {
  checkInDate: string | null;
  checkOutDate: string | null;
  guests: number;
}

export interface RawSearchInput extends RawDatesGuests {
  destination: string;
}

/** Valide dates + voyageurs (commun aux deux modes ; la proximité n'a pas de destination). */
export function validateDatesGuests(
  input: RawDatesGuests,
): SearchValidationError[] {
  const errors: SearchValidationError[] = [];

  const checkIn =
    input.checkInDate !== null ? parseDateOnlyUtc(input.checkInDate) : null;
  const checkOut =
    input.checkOutDate !== null ? parseDateOnlyUtc(input.checkOutDate) : null;

  if (checkIn === null || checkOut === null) {
    errors.push("datesRequired");
  } else {
    if (checkIn < todayUtcMidnight()) {
      errors.push("checkInPast");
    }
    if (checkOut <= checkIn) {
      errors.push("checkOutBeforeCheckIn");
    }
  }

  if (!Number.isInteger(input.guests) || input.guests < MIN_GUESTS) {
    errors.push("guestsMin");
  } else if (input.guests > MAX_GUESTS) {
    errors.push("guestsMax");
  }

  return errors;
}

/** Valide une saisie de recherche par destination. Renvoie les codes d'erreur (vide si valide). */
export function validateSearchInput(
  input: RawSearchInput,
): SearchValidationError[] {
  const errors: SearchValidationError[] = [];
  if (input.destination.trim().length === 0) {
    errors.push("destinationRequired");
  }
  errors.push(...validateDatesGuests(input));
  return errors;
}

/** Valide des coordonnées de géolocalisation (bornes lat/long). */
export function validateCoords(
  latitude: number,
  longitude: number,
): SearchValidationError[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return ["coordsRequired"];
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return ["coordsInvalid"];
  }
  return [];
}

// ── Filtres & tri (FR-3, story 1.8) ────────────────────────────────────────────
// Portés par l'URL et communs aux deux modes. AC-7 : une valeur douteuse est **omise**
// (jamais une invalidité de page) — seuls destination/dates/coords restent bloquants.

export const SORT_OPTIONS = ["price_asc", "price_desc", "distance"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

/** Cardinalité max d'un filtre multi-valeurs + longueur max d'un token (miroir du BFF). */
export const MAX_FILTER_VALUES = 20;
export const MAX_TOKEN_LENGTH = 40;
const DIACRITICS = /[̀-ͯ]/g;

/** Normalise un libellé pour comparaison/dé-duplication insensible casse + accents (Décision 4). */
export function normalizeToken(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(DIACRITICS, "");
}

/** Filtres/tri normalisés, tous optionnels (absent = pas de filtre). */
export interface ParsedFilters {
  sort?: SortOption;
  /** Cents entiers, sur le total du séjour. */
  minPrice?: number;
  maxPrice?: number;
  minCapacity?: number;
  category?: string[];
  amenities?: string[];
}

function isSortOption(value: string | undefined): value is SortOption {
  return (
    value !== undefined && (SORT_OPTIONS as readonly string[]).includes(value)
  );
}

function toNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function toBoundedInt(
  raw: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function allValues(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Tokens trimés, bornés, dé-dupliqués par forme normalisée (display conservé). `splitCsv` autorise
 * en plus le découpage sur `,` — **interdit pour la catégorie** (texte libre PMS pouvant contenir
 * une virgule → corruption au round-trip), autorisé pour les équipements (tokens sans virgule).
 */
function sanitizeTokens(values: string[], splitCsv: boolean): string[] {
  const parts = splitCsv ? values.flatMap((v) => v.split(",")) : values;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_LENGTH) {
      continue;
    }
    const key = normalizeToken(trimmed);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_FILTER_VALUES) {
      return out;
    }
  }
  return out;
}

/** Parse/normalise les filtres/tri d'URL (jamais bloquant — valeurs douteuses ignorées). */
export function parseFilters(
  searchParams: Record<string, string | string[] | undefined>,
): ParsedFilters {
  const filters: ParsedFilters = {};

  const sort = firstValue(searchParams.sort);
  if (isSortOption(sort)) {
    filters.sort = sort;
  }

  const minPrice = toNonNegativeInt(firstValue(searchParams.minPrice));
  const maxPrice = toNonNegativeInt(firstValue(searchParams.maxPrice));
  // Bornes incohérentes (min > max) → les deux ignorées (AC-7).
  const coherent =
    minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice;
  if (coherent) {
    if (minPrice !== undefined) {
      filters.minPrice = minPrice;
    }
    if (maxPrice !== undefined) {
      filters.maxPrice = maxPrice;
    }
  }

  const minCapacity = toBoundedInt(
    firstValue(searchParams.minCapacity),
    MIN_GUESTS,
    MAX_GUESTS,
  );
  if (minCapacity !== undefined) {
    filters.minCapacity = minCapacity;
  }

  const category = sanitizeTokens(allValues(searchParams.category), false);
  if (category.length > 0) {
    filters.category = category;
  }
  const amenities = sanitizeTokens(allValues(searchParams.amenities), true);
  if (amenities.length > 0) {
    filters.amenities = amenities;
  }

  return filters;
}

export interface ParsedDestinationParams extends ParsedFilters {
  mode: "destination";
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  /** Devise de travail portée par l'URL (segmentation) ; défaut si absente/invalide. */
  currency: Currency;
}

export interface ParsedNearbyParams extends ParsedFilters {
  mode: "nearby";
  latitude: number;
  longitude: number;
  radiusKm?: number;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  currency: Currency;
}

export type ParsedSearchParams = ParsedDestinationParams | ParsedNearbyParams;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse une coordonnée d'URL. Vide/blanc/absent → `NaN` (et non `Number("")===0`) pour que
 *  `validateCoords` renvoie `coordsRequired` au lieu d'une fausse position (0,0). */
function toCoordNumber(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return NaN;
  }
  return Number(raw);
}

/**
 * Parse + valide les query-params de la page de résultats (destination OU proximité selon
 * `mode`). Un résultat invalide n'entraîne AUCUN appel BFF/PMS (la page affiche l'état invalide).
 */
export function parseSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
):
  | { ok: true; value: ParsedSearchParams }
  | { ok: false; errors: SearchValidationError[] } {
  const checkInDate = firstValue(searchParams.checkInDate) ?? null;
  const checkOutDate = firstValue(searchParams.checkOutDate) ?? null;
  const guestsRaw = firstValue(searchParams.guests);
  const guests = guestsRaw !== undefined ? Number(guestsRaw) : NaN;
  const currencyRaw = firstValue(searchParams.currency);
  const currency: Currency = isCurrency(currencyRaw)
    ? currencyRaw
    : defaultCurrency;

  if (firstValue(searchParams.mode) === "nearby") {
    const latitude = toCoordNumber(firstValue(searchParams.latitude));
    const longitude = toCoordNumber(firstValue(searchParams.longitude));
    const radiusRaw = firstValue(searchParams.radiusKm);
    const radiusNum = radiusRaw !== undefined ? Number(radiusRaw) : undefined;
    const radiusKm =
      radiusNum !== undefined && Number.isFinite(radiusNum) && radiusNum > 0
        ? radiusNum
        : undefined;

    const errors = [
      ...validateCoords(latitude, longitude),
      ...validateDatesGuests({ checkInDate, checkOutDate, guests }),
    ];
    if (errors.length > 0 || checkInDate === null || checkOutDate === null) {
      return {
        ok: false,
        errors: errors.length > 0 ? errors : ["datesRequired"],
      };
    }
    return {
      ok: true,
      value: {
        mode: "nearby",
        latitude,
        longitude,
        radiusKm,
        checkInDate,
        checkOutDate,
        guests,
        currency,
        ...parseFilters(searchParams),
      },
    };
  }

  const destination = firstValue(searchParams.destination) ?? "";
  const errors = validateSearchInput({
    destination,
    checkInDate,
    checkOutDate,
    guests,
  });
  if (errors.length > 0 || checkInDate === null || checkOutDate === null) {
    return {
      ok: false,
      errors: errors.length > 0 ? errors : ["datesRequired"],
    };
  }

  return {
    ok: true,
    value: {
      mode: "destination",
      destination,
      checkInDate,
      checkOutDate,
      guests,
      currency,
      ...parseFilters(searchParams),
    },
  };
}
