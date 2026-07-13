import { describe, it, expect } from "vitest";

import { cn, formatCurrency, formatDate } from "@/lib/utils";

// Tests unitaires (Story 1.5) : formatage monétaire cents-aware + dates (AR-12,
// UX-DR-8.4). La `locale` pilote le format ; la `currency` reste transportée.
describe("utils: cn", () => {
  it("fusionne et déduplique les classes", () => {
    expect(cn("px-2", false && "hidden", "py-1")).toBe("px-2 py-1");
  });
});

describe("utils: formatCurrency (unités mineures / cents)", () => {
  it("formate des cents EUR en français, décimales nulles retirées (168 €)", () => {
    const out = formatCurrency(16800, "EUR", "fr");
    expect(out).toMatch(/168/);
    expect(out).toContain("€");
    expect(out).not.toContain(",00");
  });

  it("conserve les décimales non nulles (168,50 €)", () => {
    expect(formatCurrency(16850, "EUR", "fr")).toMatch(/168,50/);
  });

  it("formate des cents USD en anglais, sans décimales nulles ($182)", () => {
    const out = formatCurrency(18200, "USD", "en");
    expect(out).toMatch(/\$182\b/);
    expect(out).not.toContain(".00");
  });

  it("transporte la devise indépendamment de la locale (USD affiché en fr)", () => {
    const out = formatCurrency(18200, "USD", "fr");
    expect(out).toMatch(/182/);
    expect(out).not.toContain(",00");
    // La devise reste USD : le symbole/notation USD apparaît (pas d'€).
    expect(out).not.toContain("€");
  });

  it("gère le zéro et les grands montants", () => {
    const zero = formatCurrency(0, "EUR", "fr");
    expect(zero).toContain("0");
    expect(zero).toContain("€");
    expect(zero).not.toContain(",00");
    expect(formatCurrency(123456789, "EUR", "fr")).toMatch(/1\s?234\s?567,89/);
  });

  it("refuse les montants non entiers (garde AR-12 : jamais de flottant)", () => {
    expect(() => formatCurrency(168.5, "EUR", "fr")).toThrow();
  });

  // Story 1.9 : devise propre de l'hôtel à 0 décimale (JPY) — l'unité mineure EST le yen.
  it("formate une devise à 0 décimale sans division erronée (JPY)", () => {
    const out = formatCurrency(12000, "JPY", "en");
    expect(out).toMatch(/12,000/); // 12000 (exposant 0), pas 120
    expect(out).not.toContain(".00");
  });

  it("ne lève jamais sur un code devise invalide (repli montant + code)", () => {
    expect(() => formatCurrency(16800, "INVALID_CODE", "fr")).not.toThrow();
    const out = formatCurrency(16800, "INVALID_CODE", "fr");
    expect(out).toContain("INVALID_CODE");
    expect(out).toMatch(/168/);
  });
});

describe("utils: formatDate", () => {
  it("formate une date ISO en UTC (jour exact, sans décalage de fuseau)", () => {
    const iso = "2026-07-05T00:00:00.000Z";
    const fr = formatDate(iso, "fr");
    const en = formatDate(iso, "en");
    // Jour calendaire = 5 (UTC), quel que soit le fuseau d'exécution du test.
    expect(fr).toMatch(/5\s?juil/);
    expect(fr).toMatch(/2026/);
    expect(en).toMatch(/Jul\s?5/);
    expect(en).toMatch(/2026/);
    // Formats localisés distincts.
    expect(fr).not.toBe(en);
  });
});
