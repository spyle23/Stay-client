import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { minorUnitExponent } from "@/lib/currency";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formate un montant exprimé en UNITÉS MINEURES ENTIÈRES (cents) selon la locale.
 *
 * AR-12 : jamais de flottant pour transporter la valeur ; la devise est toujours
 * transportée avec le montant ; aucune conversion inter-devises. La `locale`
 * pilote uniquement le formatage (groupement, position/écriture du symbole) ; la
 * `currency` reste celle du montant (hôtel/segment) et n'est jamais dérivée de la
 * langue. Les décimales nulles sont retirées (`trailingZeroDisplay`) pour coller
 * au design-system : ex. `formatCurrency(16800, "EUR", "fr")` → « 168 € », mais
 * `formatCurrency(16850, "EUR", "fr")` → « 168,50 € ».
 */
export function formatCurrency(
  amountMinor: number,
  currency: string,
  locale = "fr",
): string {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(
      `formatCurrency attend des unités mineures entières (cents), reçu: ${amountMinor}.`,
    );
  }
  const major = amountMinor / 10 ** minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    trailingZeroDisplay: "stripIfInteger",
  }).format(major);
}

/**
 * Formate une date ISO 8601 (UTC sur le fil, AR-12) selon la locale, en affichage
 * abrégé (ex. fr « 5 juil. 2026 », en « Jul 5, 2026 »).
 */
export function formatDate(iso: string, locale = "fr"): string {
  // `timeZone: "UTC"` : les dates arrivent en UTC sur le fil (AR-12) → on rend le
  // jour calendaire tel quel, sans décalage selon le fuseau du client (évite un
  // off-by-one et tout mismatch SSR/CSR).
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}
