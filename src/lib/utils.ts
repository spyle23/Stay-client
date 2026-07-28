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
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      trailingZeroDisplay: "stripIfInteger",
    }).format(major);
  } catch {
    // Code devise invalide/inconnu (hors ISO 4217) → repli sûr « montant CODE », jamais
    // d'exception (la page hôtel affiche la devise propre de l'hôtel, story 1.9).
    return `${new Intl.NumberFormat(locale).format(major)} ${currency}`;
  }
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

/**
 * Formate un **instant** ISO 8601 (date + heure, UTC sur le fil) en conservant l'heure.
 *
 * Distinct de `formatDate`, réservé aux date-only : appliquer un rendu date-only à une échéance
 * horaire (limite d'annulation, expiration de hold) **efface l'heure** et laisse croire que la
 * journée entière est acquise — un contresens facturable. Rendu en UTC avec le fuseau visible,
 * pour que l'échéance affichée soit celle qui fera foi (revue 2.2).
 *
 * Renvoie `null` si la valeur n'est pas un instant exploitable : `Intl.DateTimeFormat.format`
 * **lève** un `RangeError` sur une `Invalid Date`, et une donnée amont douteuse ne doit pas
 * pouvoir faire tomber l'écran qui précède le paiement.
 */
export function formatDateTime(iso: string, locale = "fr"): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Champs explicites (et non `dateStyle`/`timeStyle`) : la spec ECMA-402 **interdit** de les
  // combiner avec `timeZoneName`, et `Intl.DateTimeFormat` lève un `TypeError` si on le tente.
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}
