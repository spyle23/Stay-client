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

// Exposant d'unités mineures (nombre de décimales). EUR/USD = 2. Défaut 2.
const MINOR_UNIT_EXPONENT: Record<string, number> = { EUR: 2, USD: 2 };

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency] ?? 2;
}
