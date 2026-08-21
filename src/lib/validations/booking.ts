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
import { isLocale, type Locale } from "@/i18n/config";
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

// --- Préférences de réservation (story 2.5, FR-10) -----------------------------------------
//
// ⚠️ Ces deux champs n'entrent **jamais** dans `ParsedBookingParams` ni dans
// `bookingContextQuery()`. Ce n'est pas un oubli : le contexte de tunnel voyage dans l'URL, et une
// demande spéciale est un texte libre qui peut contenir des données de santé ou d'accessibilité
// (RGPD art. 9). L'URL est partagée, mise en historique, envoyée en `Referer` et journalisée par
// tous les intermédiaires. Ce texte part donc dans le **corps** du POST de création, et nulle part
// ailleurs.

/**
 * Longueur maximale d'une demande spéciale, **en unités UTF-16** (revue 2ᵉ passe, F11).
 *
 * Pas « en caractères » : 500 emoji valent 1000, et un accent décomposé vaut 2 pour un glyphe.
 * L'écart est sans danger dans ce sens — une unité vaut au plus un point de code, donc la mesure
 * majore toujours ce que PostgreSQL comptera.
 *
 * ⚠️ Miroir de `SPECIAL_REQUESTS_MAX_LENGTH` du BFF
 * (`stay-client-bff/src/modules/booking/special-requests.ts`). Les deux dépôts sont séparés :
 * aucun test ne peut vérifier l'égalité — si l'une des deux valeurs bouge, l'autre doit suivre,
 * sinon le compteur affiché au voyageur ment et le refus tombe au moment de réserver.
 */
export const SPECIAL_REQUESTS_MAX_LENGTH = 1000;

/**
 * Caractères **invisibles** neutralisés — miroir de `INVISIBLE` du BFF.
 * Contrôles C0/C1 (`\p{Cc}`) et caractères de formatage Unicode (`\p{Cf}`).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/** Fins de ligne Windows et CR isolés — miroir de `LINE_ENDINGS` du BFF. */
const LINE_ENDINGS = /\r\n?/g;

/**
 * Normalise une demande spéciale **exactement comme le BFF** avant de la mesurer.
 *
 * ⚠️ Miroir de `normalizeSpecialRequests`
 * (`stay-client-bff/src/modules/booking/special-requests.ts`). Duplication assumée : les deux
 * dépôts sont séparés, et c'est déjà le cas de `SPECIAL_REQUESTS_MAX_LENGTH`. Toute modification
 * de l'une doit suivre dans l'autre.
 *
 * **Pourquoi c'est nécessaire** (revue 2ᵉ passe, F5) : le front mesurait `raw.trim().length`, le
 * BFF mesure après normalisation. `trim()` ne retire ni U+00AD, ni U+200B, ni les caractères de
 * contrôle. Un texte collé depuis un PDF avec des traits d'union conditionnels affichait donc
 * « 1002 / 1000 », passait au rouge et était **refusé localement** — alors que le BFF aurait
 * mesuré 1000 et accepté. Le front était plus strict que l'autorité.
 *
 * Sert trois usages, tous devant compter pareil : le compteur, la validation, et la comparaison
 * avec ce que le PMS a réellement stocké.
 */
export function normalizeSpecialRequests(raw: string): string {
  return raw
    .replace(LINE_ENDINGS, "\n")
    .replace(INVISIBLE, (char) => (char === "\n" ? char : " "))
    .trim();
}

/**
 * Préférences de communication soumises avec la création de la Réservation.
 *
 * `communicationLocale` réutilise les locales d'interface (`i18n/config.ts`) : elles coïncident
 * exactement avec les langues que le moteur d'emails du PMS sait rendre (`fr`, `en`).
 */
export interface BookingPreferences {
  specialRequests: string;
  communicationLocale: Locale;
  /**
   * Le voyageur a-t-il **touché** le sélecteur de langue ? (revue 2ᵉ passe, F6, décision (a))
   *
   * ⚠️ Sans ce drapeau, `communicationLocale` partait **toujours** : un défaut pré-rempli était
   * transmis au BFF comme une décision, l'état « aucun choix » devenait inatteignable, et toute la
   * plomberie `?? null` du BFF — ainsi que la promesse du DTO « le front doit pouvoir distinguer
   * “pas de choix” de “choix = fr” » — devenait du code mort.
   *
   * Tant qu'il vaut `false`, le sélecteur **suit** la langue d'interface (y compris si elle change
   * en cours de route) et rien n'est envoyé.
   */
  localeTouched: boolean;
}

/** Codes d'erreur i18n des préférences (namespace `booking`). */
export type BookingPreferencesError = "specialRequestsTooLong";

/**
 * Valide les préférences **telles qu'elles seront envoyées**.
 *
 * La longueur est mesurée sur la valeur `trim()`ée, comme le fait le BFF après normalisation :
 * refuser un texte à cause de ses espaces de bord serait incompréhensible côté voyageur.
 */
export function validateBookingPreferences(
  preferences: BookingPreferences,
): BookingPreferencesError[] {
  const errors: BookingPreferencesError[] = [];
  if (
    specialRequestsLength(preferences.specialRequests) >
    SPECIAL_REQUESTS_MAX_LENGTH
  ) {
    errors.push("specialRequestsTooLong");
  }
  return errors;
}

/**
 * Longueur d'une demande spéciale **telle que le BFF la mesurera**.
 *
 * Source unique du compteur et de la validation : les deux doivent compter pareil, sans quoi le
 * compteur annonce une limite que le refus ne respecte pas (ou l'inverse — voir F5).
 *
 * ⚠️ Compte des **unités UTF-16**, pas des graphèmes : 500 emoji valent 1000. C'est aligné sur
 * `@MaxLength` côté BFF, et sûr vis-à-vis de PostgreSQL (une unité vaut au plus un point de code).
 */
export function specialRequestsLength(raw: string): number {
  return normalizeSpecialRequests(raw).length;
}

/**
 * Préférences par défaut : aucune demande, la langue **de l'interface courante**, non touchée.
 *
 * `localeTouched: false` — le sélecteur affiche cette langue mais ne l'a pas *choisie* : rien ne
 * partira au BFF tant que le voyageur n'y touche pas.
 */
export function defaultBookingPreferences(locale: string): BookingPreferences {
  return {
    specialRequests: "",
    // Une locale inconnue (cookie retouché) ne doit pas produire une valeur que le BFF refusera :
    // on retombe sur le français, langue de repli du produit.
    communicationLocale: isLocale(locale) ? locale : "fr",
    localeTouched: false,
  };
}

/**
 * Réaligne la langue **non touchée** sur la locale d'interface (revue 2ᵉ passe, F14).
 *
 * `LocaleSwitcher` écrit un cookie puis appelle `router.refresh()`, qui **préserve l'état client** :
 * toute l'interface passait en anglais pendant que le sélecteur restait sur « Français », et c'est
 * cette valeur périmée qui partait au BFF. AC-3 (« pré-sélectionné sur la locale d'interface
 * courante ») n'était donc vrai qu'au premier rendu.
 *
 * Un choix **explicite** du voyageur n'est jamais écrasé.
 */
export function syncPreferencesLocale(
  preferences: BookingPreferences,
  locale: string,
): BookingPreferences {
  const next = isLocale(locale) ? locale : "fr";
  if (preferences.localeTouched || preferences.communicationLocale === next) {
    return preferences;
  }
  return { ...preferences, communicationLocale: next };
}
