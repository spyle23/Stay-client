import { minorUnitExponent } from "../../../src/lib/currency";

/**
 * Montant **affiché** par l'écran, relu en unités mineures entières de `currency`
 * (spyle23/hotelerie#2, AC-4).
 *
 * Le smoke d'upsell multipliait le texte par 100 : juste pour l'euro, faux d'un facteur 10ⁿ pour
 * toute devise dont l'exposant n'est pas 2 (MGA ou JPY à 0 décimale, KWD à 3). L'exposant vient
 * donc du **même** helper que l'écran (`lib/currency.ts`), et le séparateur décimal est reconnu
 * à sa position plutôt que supposé : virgule en français, point en anglais, groupes de milliers
 * séparés par des espaces insécables ou des virgules.
 *
 * ⚠️ Limite connue : un montant entier d'une devise à 3 décimales, groupé par milliers en anglais
 * (`KWD 12,345` = 12 345 KWD), se lit comme 12,345 KWD. Le smoke ne vise que la devise du jeu de
 * référence (EUR).
 */
export function displayedMinorUnits(text: string, currency: string): number {
  const exponent = minorUnitExponent(currency);
  const numeric = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) {
    throw new Error(`Aucun montant lisible dans « ${text} ».`);
  }

  let integerPart = numeric;
  let fraction = "";
  if (exponent > 0) {
    const decimal = new RegExp(`^(.*)[.,]([0-9]{${exponent}})$`).exec(numeric);
    if (decimal) {
      integerPart = decimal[1];
      fraction = decimal[2];
    }
  }

  const units = Number(integerPart.replace(/[.,]/g, "") || "0");
  return units * 10 ** exponent + Number(fraction || "0");
}
