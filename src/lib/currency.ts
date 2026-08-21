// Socle « devise de travail » de l'Application Cliente (FR-20, UX-DR-8.2, AR-12).
//
// La devise de travail SEGMENTE les résultats vers une seule devise : elle ne
// convertit JAMAIS et ne compare JAMAIS deux devises. Elle ne dérive ni la devise
// propre d'un hôtel, ni la devise de paiement (celles-ci restent intactes).
// L'argent circule en UNITÉS MINEURES ENTIÈRES (cents) avec sa devise toujours
// transportée ; aucun calcul en flottant (AR-12).

export const currencies = ["EUR", "USD"] as const;
export type Currency = (typeof currencies)[number];

export const defaultCurrency: Currency = "EUR";

// Cookie de persistance de la devise de travail (lu côté serveur par le layout
// pour une hydratation SSR cohérente — même mécanisme que `NEXT_LOCALE`).
export const CURRENCY_COOKIE = "WORKING_CURRENCY";

export const currencySymbols: Record<Currency, string> = {
  EUR: "€",
  USD: "$",
};

export function isCurrency(
  value: string | undefined | null,
): value is Currency {
  return value != null && (currencies as readonly string[]).includes(value);
}

/**
 * Devise de travail par défaut dérivée de la langue/région (AC2). Ce défaut ne
 * fait que choisir le SEGMENT initial ; il n'implique aucune conversion.
 */
export function defaultCurrencyForLocale(locale: string): Currency {
  return locale.startsWith("en") ? "USD" : "EUR";
}

// Exposant d'unités mineures (nombre de décimales). Chemin rapide EUR/USD = 2.
const MINOR_UNIT_EXPONENT: Record<string, number> = { EUR: 2, USD: 2 };

// Cache des exposants dérivés pour les devises hors chemin rapide (évite de reconstruire
// un Intl.NumberFormat à chaque appel — la page hôtel affiche la devise propre de l'hôtel,
// potentiellement quelconque : JPY/XOF = 0 décimale, BHD/KWD = 3, la plupart = 2).
const derivedExponentCache = new Map<string, number>();

/**
 * Nombre de décimales (exposant d'unités mineures) d'une devise. EUR/USD = 2 (chemin rapide).
 * Pour toute autre devise (page hôtel — devise propre de l'Hôtel, story 1.9), l'exposant réel est
 * dérivé de l'ICU via `Intl.NumberFormat().resolvedOptions().maximumFractionDigits` (JPY → 0,
 * BHD → 3, etc.) plutôt que supposé à 2. Un code devise invalide/inconnu retombe **sûrement** sur
 * 2, sans jamais lever.
 */
export function minorUnitExponent(currency: string): number {
  const fast = MINOR_UNIT_EXPONENT[currency];
  if (fast !== undefined) {
    return fast;
  }
  const cached = derivedExponentCache.get(currency);
  if (cached !== undefined) {
    return cached;
  }
  let exponent = 2;
  try {
    const resolved = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
    if (typeof resolved.maximumFractionDigits === "number") {
      exponent = resolved.maximumFractionDigits;
    }
  } catch {
    // Code devise invalide (format non ISO 4217) → repli sûr à 2 décimales.
    exponent = 2;
  }
  derivedExponentCache.set(currency, exponent);
  return exponent;
}

/** Codes devise connus de l'ICU, résolus une seule fois (la liste en compte ~300). */
let icuCurrencyCodes: ReadonlySet<string> | undefined;

/**
 * L'exposant d'unités mineures de cette devise est-il **réellement** connu ?
 *
 * `minorUnitExponent` (front) et `minorUnitExponent` (BFF) retombent tous deux sur 2 décimales
 * pour une devise que l'ICU ne connaît pas — et un code libre saisi en back-office passe sans
 * lever : `Intl` accepte n'importe quel code bien formé et lui prête 2 décimales par défaut. La
 * seule vérification fiable est l'appartenance à la liste ICU.
 */
export function isCurrencyExponentReliable(currency: string): boolean {
  if (icuCurrencyCodes === undefined) {
    try {
      icuCurrencyCodes = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      icuCurrencyCodes = new Set<string>();
    }
  }
  if (icuCurrencyCodes.size === 0) {
    // Environnement sans `Intl.supportedValuesOf` : on ne peut pas trancher. On ne fabrique pas un
    // doute qui masquerait tous les montants — on se limite au code manifestement non formable.
    return /^[A-Za-z]{3}$/.test(currency);
  }
  return icuCurrencyCodes.has(currency.toUpperCase());
}
