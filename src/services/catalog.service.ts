import { api } from "@/lib/api-client";
import { buildHotelSlug } from "@/lib/hotel-slug";

/**
 * Service du domaine `catalog` (story 1.9, FR-5) — **page hôtel publique**. Appelle **le BFF**
 * (`GET /catalog/hotels/:id`), jamais le PMS. Contrat miroir du `HotelDetailDto` du BFF : montants
 * en **unités mineures entières de la devise de l'Hôtel** (l'exposant dépend de la devise — cf.
 * `lib/currency.ts#minorUnitExponent`), `null` (jamais `undefined`), aucune conversion de devise.
 *
 * Utilisable côté serveur (SSR — `api.get` s'appuie sur `fetch`) comme côté client (React Query).
 */

/** Une image de la galerie hôtel. L'`alt` est composé **côté front** (i18n), pas par le BFF. */
export interface HotelGalleryImage {
  url: string;
  /** Numéro de la chambre d'origine, ou `null` si l'image est celle de l'hôtel (logo). */
  roomNumber: string | null;
}

/** Chambre exposée sur la page hôtel (miroir `HotelRoomDto` du BFF). */
export interface HotelRoomResult {
  id: string;
  hotelId: string;
  number: string | null;
  category: string | null;
  /** `null` si le PMS ne renseigne pas la capacité (ne jamais afficher « 0 voyageur »). */
  capacity: number | null;
  amenities: string | null;
  floor: number | null;
  /** Prix par nuit (unités mineures), dans la devise de l'Hôtel. */
  pricePerNight: number;
  /** Total du séjour (unités mineures) ; `null` si aucune date en contexte. */
  totalPrice: number | null;
  currency: string;
  /** Nombre de nuits ; `null` si aucune date. */
  nights: number | null;
}

/** Détail hôtel (miroir `HotelDetailDto` du BFF). */
export interface HotelDetailResult {
  id: string;
  name: string | null;
  category: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  /** Devise **résolue** de l'Hôtel — la même que celle portée par les chambres. */
  currency: string;
  locale: string | null;
  logoUrl: string | null;
  roomCount: number;
  gallery: HotelGalleryImage[];
  rooms: HotelRoomResult[];
  /**
   * Nuits du **contexte de séjour retenu par le BFF** (dates valides, non passées, bornées), sinon
   * `null`. Source de vérité de « l'utilisateur a-t-il des dates ? » — ne PAS le déduire de
   * `rooms[0]` (une liste vide masquerait l'invitation à choisir des dates).
   */
  stayNights: number | null;
  /** Disponibilité des chambres momentanément injoignable (dégradation gracieuse). */
  roomsUnavailable: boolean;
}

/** Contexte de séjour optionnel (dates + voyageurs). Absent = affichage prix/nuit. */
export interface HotelDetailParams {
  checkInDate?: string;
  checkOutDate?: string;
  guests?: number;
}

/** Convention de clés React Query. */
export const catalogKeys = {
  all: ["catalog"] as const,
  hotel: (id: string, params: HotelDetailParams) =>
    ["catalog", "hotel", id, params] as const,
};

/**
 * Émet uniquement `checkInDate`/`checkOutDate`/`guests` (déclarés au DTO BFF). **Ne PAS** émettre
 * d'autre param (le `ValidationPipe` global rejette tout param hors liste → 400, cf. bug 1.7).
 */
function toQueryString(params: HotelDetailParams): string {
  const query = new URLSearchParams();
  if (params.checkInDate) {
    query.set("checkInDate", params.checkInDate);
  }
  if (params.checkOutDate) {
    query.set("checkOutDate", params.checkOutDate);
  }
  if (params.guests !== undefined) {
    query.set("guests", String(params.guests));
  }
  return query.toString();
}

/** Récupère le détail d'un hôtel (par GUID) + ses chambres pour les dates en contexte. */
export function fetchHotelDetail(
  id: string,
  params: HotelDetailParams = {},
): Promise<HotelDetailResult> {
  const qs = toQueryString(params);
  const suffix = qs ? `?${qs}` : "";
  return api.get<HotelDetailResult>(
    `/catalog/hotels/${encodeURIComponent(id)}${suffix}`,
  );
}

/**
 * URL **navigateur** de la page hôtel `/hotels/{slug}` (slug résolu par GUID, Décision 1), en
 * **préservant** le contexte : dates, voyageurs **et devise de travail** (AC-2/AC-12) — la devise
 * n'est pas envoyée au BFF (la fiche affiche la devise de l'Hôtel) mais reste dans l'URL pour que
 * le retour/partage conserve le contexte de recherche.
 */
export function buildHotelPageUrl(
  id: string,
  name: string | null,
  ctx: HotelDetailParams & { currency?: string } = {},
): string {
  const slug = buildHotelSlug(name, id);
  const query = new URLSearchParams(toQueryString(ctx));
  if (ctx.currency) {
    query.set("currency", ctx.currency);
  }
  const qs = query.toString();
  return qs ? `/hotels/${slug}?${qs}` : `/hotels/${slug}`;
}
