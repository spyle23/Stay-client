// Brique de géolocalisation navigateur (FR-2 — story 1.7). Pure et testable : encapsule
// `navigator.geolocation`, détecte l'absence de support / le contexte non sécurisé, mappe les
// erreurs vers un type union stable, et ARRONDIT les coordonnées (~3 décimales ≈ 110 m) pour
// limiter l'exposition de la position (NFR-5). Aucune UI ici.

/** Précision de coordonnée conservée : 3 décimales ≈ 110 m (confidentialité NFR-5). */
const COORD_PRECISION = 3;

export type GeolocationFailureReason =
  | "unsupported" // navigator.geolocation absent (vieux navigateur)
  | "insecure" // contexte non sécurisé (non-HTTPS, hors localhost)
  | "denied" // l'utilisateur a refusé l'autorisation
  | "unavailable" // position indisponible (capteur/OS)
  | "timeout"; // délai dépassé

export interface GeolocationSuccess {
  ok: true;
  latitude: number;
  longitude: number;
}
export interface GeolocationFailure {
  ok: false;
  reason: GeolocationFailureReason;
}
export type GeolocationResult = GeolocationSuccess | GeolocationFailure;

/** Arrondit une coordonnée à `COORD_PRECISION` décimales. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/** Le navigateur expose-t-il l'API de géolocalisation ? */
export function isGeolocationSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "geolocation" in navigator &&
    typeof navigator.geolocation?.getCurrentPosition === "function"
  );
}

/** Contexte sécurisé (HTTPS ou localhost) — requis par l'API de géolocalisation. */
function isSecureContext(): boolean {
  if (typeof window === "undefined") {
    return true; // SSR : ne bloque pas (le déclenchement est côté navigateur).
  }
  return window.isSecureContext !== false;
}

// Codes standard de `GeolocationPositionError` (constantes d'instance non fiables selon les mocks).
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function mapError(code: number): GeolocationFailureReason {
  switch (code) {
    case PERMISSION_DENIED:
      return "denied";
    case TIMEOUT:
      return "timeout";
    case POSITION_UNAVAILABLE:
    default:
      return "unavailable";
  }
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};

/**
 * Demande la position courante. Ne rejette JAMAIS : renvoie un résultat discriminé
 * (`ok: true|false`) afin que l'appelant gère le repli sans try/catch (AC-2).
 */
export function requestCurrentPosition(
  options: PositionOptions = {},
): Promise<GeolocationResult> {
  if (!isGeolocationSupported()) {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }
  if (!isSecureContext()) {
    return Promise.resolve({ ok: false, reason: "insecure" });
  }
  return new Promise<GeolocationResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          latitude: roundCoordinate(position.coords.latitude),
          longitude: roundCoordinate(position.coords.longitude),
        }),
      (error) => resolve({ ok: false, reason: mapError(error.code) }),
      { ...DEFAULT_OPTIONS, ...options },
    );
  });
}
