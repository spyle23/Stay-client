import { describe, it, expect } from "vitest";

import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  localeNames,
  locales,
} from "@/i18n/config";
import frMessages from "@/i18n/messages/fr.json";
import enMessages from "@/i18n/messages/en.json";

// Tests unitaires (Story 1.5) : config de locales + parité des catalogues i18n.
describe("i18n: config des locales", () => {
  it("expose fr/en avec fr par défaut et le cookie NEXT_LOCALE", () => {
    expect(locales).toEqual(["fr", "en"]);
    expect(defaultLocale).toBe("fr");
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
    expect(localeNames.fr).toBe("Français");
    expect(localeNames.en).toBe("English");
  });

  it("isLocale valide uniquement les locales supportées", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("i18n: parité des catalogues fr/en", () => {
  function keyPaths(obj: unknown, prefix = ""): string[] {
    if (obj === null || typeof obj !== "object") return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      keyPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it("fr.json et en.json ont exactement les mêmes clés", () => {
    const frKeys = keyPaths(frMessages).sort();
    const enKeys = keyPaths(enMessages).sort();
    expect(frKeys).toEqual(enKeys);
  });
});
