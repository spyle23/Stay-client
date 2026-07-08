import { describe, it, expect } from "vitest";

import {
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
});
