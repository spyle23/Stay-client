import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT, safeInternalPath } from "@/lib/safe-redirect";

describe("safeInternalPath (garde anti open-redirect)", () => {
  it("accepte un chemin interne, avec query et fragment", () => {
    expect(safeInternalPath("/account")).toBe("/account");
    expect(safeInternalPath("/account/reservations?page=2")).toBe(
      "/account/reservations?page=2",
    );
  });

  it("rejette une URL absolue externe", () => {
    for (const value of [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
    ]) {
      expect(safeInternalPath(value)).toBe(DEFAULT_REDIRECT);
    }
  });

  it("rejette les pseudo-schémas (javascript:, data:)", () => {
    expect(safeInternalPath("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
    expect(safeInternalPath("data:text/html,<script>")).toBe(DEFAULT_REDIRECT);
  });

  it("rejette un chemin relatif (ambigu selon la page courante)", () => {
    expect(safeInternalPath("account")).toBe(DEFAULT_REDIRECT);
    expect(safeInternalPath("../admin")).toBe(DEFAULT_REDIRECT);
  });

  it("rejette les caractères de contrôle (injection d’en-tête / contournement de parseur)", () => {
    expect(safeInternalPath("/account\nSet-Cookie: x=1")).toBe(
      DEFAULT_REDIRECT,
    );
    expect(safeInternalPath("/\t/evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("retombe sur le défaut pour une valeur absente ou vide", () => {
    expect(safeInternalPath(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeInternalPath(null)).toBe(DEFAULT_REDIRECT);
    expect(safeInternalPath("")).toBe(DEFAULT_REDIRECT);
  });

  it("respecte un repli explicite", () => {
    expect(safeInternalPath("https://evil.example", "/")).toBe("/");
  });
});
