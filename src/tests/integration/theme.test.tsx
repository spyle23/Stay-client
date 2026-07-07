import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeToggle } from "@/components/atoms/theme-toggle";

// Tests d'intégration (Story 1.4) : bascule de thème (classe .dark) + contrat des
// tokens (accent hôtel + set sombre) dans globals.css. La cascade CSS réelle
// (contraste, application des tokens) est vérifiée en e2e (vrai navigateur + axe).
describe("design-system: thème & contrat de tokens", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear(); // next-themes persiste le thème → éviter la fuite d'état
  });

  it("le ThemeToggle bascule la classe .dark sur <html>", async () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
      >
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(screen.getByTestId("theme-toggle"));

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(true),
    );
  });

  describe("contrat de tokens (globals.css)", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    it("définit l'accent hôtel via [data-hotel-theme] sans fallback en dur", () => {
      // sans fallback → héritage de la valeur thémée (correctif review, AA sombre)
      expect(css).toMatch(
        /\[data-hotel-theme\]\s*\{[\s\S]*?--primary:\s*var\(--hotel-primary\)\s*;/,
      );
    });

    it("définit --primary éclairci (#2ba5b0) sous .dark pour l'AA", () => {
      expect(css).toMatch(/\.dark\s*\{[\s\S]*?--primary:\s*#2ba5b0\s*;/);
    });

    it("mappe les tokens sémantiques success/warning dans @theme", () => {
      expect(css).toMatch(/--color-success:\s*var\(--success\)\s*;/);
      expect(css).toMatch(/--color-warning:\s*var\(--warning\)\s*;/);
    });
  });
});
