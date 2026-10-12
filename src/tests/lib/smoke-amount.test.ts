import { describe, expect, it } from "vitest";

import { displayedMinorUnits } from "../../../e2e/smoke/helpers/amount";
import { formatCurrency } from "@/lib/utils";

/**
 * Lecture d'un montant affiché en unités mineures, pour le smoke d'upsell (spyle23/hotelerie#2,
 * AC-4). Le smoke multipliait par 100 : faux pour toute devise dont l'exposant n'est pas 2 (JPY,
 * MGA à 0 décimale, KWD à 3). L'exposant vient désormais de `lib/currency.ts`, comme à l'écran.
 */
describe("displayedMinorUnits (smoke)", () => {
  it.each([
    ["fr", "EUR", 4_500],
    ["fr", "EUR", 4_550],
    ["en", "EUR", 4_550],
    ["fr", "EUR", 123_456_78],
    ["en", "USD", 123_456_78],
    ["fr", "JPY", 4_500],
    ["en", "KWD", 12_345],
  ])(
    "relit en %s le montant %s formaté par l’écran",
    (locale, currency, minor) => {
      const shown = formatCurrency(minor, currency, locale);
      expect(displayedMinorUnits(shown, currency)).toBe(minor);
    },
  );

  it("n'applique pas un × 100 aveugle : 45 ¥ restent 45 unités", () => {
    expect(displayedMinorUnits("¥45", "JPY")).toBe(45);
  });

  it("refuse un texte sans montant plutôt que d'inventer 0", () => {
    expect(() => displayedMinorUnits("Montant indisponible", "EUR")).toThrow(
      /aucun montant/i,
    );
  });
});
