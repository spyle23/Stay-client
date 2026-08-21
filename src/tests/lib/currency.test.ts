import { describe, it, expect } from "vitest";

import {
  isCurrencyExponentReliable,
  currencies,
  currencySymbols,
  defaultCurrency,
  defaultCurrencyForLocale,
  isCurrency,
  minorUnitExponent,
} from "@/lib/currency";

// Tests unitaires (Story 1.5) : socle « devise de travail » (AR-12, UX-DR-8.2).
describe("currency: socle devise de travail", () => {
  it("expose EUR/USD avec leurs symboles", () => {
    expect(currencies).toEqual(["EUR", "USD"]);
    expect(currencySymbols.EUR).toBe("€");
    expect(currencySymbols.USD).toBe("$");
    expect(defaultCurrency).toBe("EUR");
  });

  it("isCurrency valide uniquement les devises supportées", () => {
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("GBP")).toBe(false);
    expect(isCurrency(undefined)).toBe(false);
    expect(isCurrency(null)).toBe(false);
  });

  it("dérive la devise de travail par défaut selon la langue", () => {
    expect(defaultCurrencyForLocale("en")).toBe("USD");
    expect(defaultCurrencyForLocale("en-US")).toBe("USD");
    expect(defaultCurrencyForLocale("fr")).toBe("EUR");
    expect(defaultCurrencyForLocale("de")).toBe("EUR"); // repli
  });

  it("expose un exposant d'unités mineures (cents) = 2, défaut 2", () => {
    expect(minorUnitExponent("EUR")).toBe(2);
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("XYZ")).toBe(2);
  });

  // Story 1.9 : la page hôtel affiche la devise PROPRE de l'hôtel (potentiellement ≠ EUR/USD).
  // L'exposant est dérivé de l'ICU, pas supposé à 2.
  it("dérive l'exposant réel des devises hors EUR/USD (JPY = 0, BHD/KWD = 3)", () => {
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("BHD")).toBe(3);
    expect(minorUnitExponent("KWD")).toBe(3);
  });

  it("retombe sûrement sur 2 pour un code devise invalide, sans lever", () => {
    expect(() => minorUnitExponent("INVALID_CODE")).not.toThrow();
    expect(minorUnitExponent("INVALID_CODE")).toBe(2);
  });
});

/**
 * `isCurrencyExponentReliable` a été extrait de `booking-payment.tsx` vers ce module par la story
 * 3.1 : il est désormais partagé par le récapitulatif et par l'écran de paiement. La revue de code
 * a constaté qu'il n'était couvert par AUCUN test — ni avant, ni après l'extraction.
 *
 * Ce qu'il garde : refuser d'afficher, et désormais de faire payer, un montant dont l'exposant
 * d'unités mineures n'est qu'une supposition. `minorUnitExponent` retombe silencieusement sur 2
 * pour tout code bien formé, y compris inventé.
 */
describe("isCurrencyExponentReliable", () => {
  it.each(["EUR", "USD", "JPY", "KWD", "eur", "jpy"])(
    "reconnaît la devise ISO 4217 %s",
    (currency) => {
      expect(isCurrencyExponentReliable(currency)).toBe(true);
    },
  );

  it.each(["ZZZ", "EURO", "", "12", "€"])(
    "refuse le code non ISO 4217 « %s »",
    (currency) => {
      expect(isCurrencyExponentReliable(currency)).toBe(false);
    },
  );

  it("refuse un code inventé bien formé, que minorUnitExponent accepterait", () => {
    // C'est tout l'intérêt de la fonction : `Intl` prête 2 décimales à n'importe quel code de trois
    // lettres, si bien qu'une faute de frappe saisie en back-office passerait sans bruit.
    expect(minorUnitExponent("QQQ")).toBe(2);
    expect(isCurrencyExponentReliable("QQQ")).toBe(false);
  });
});
