// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_E2E_PORT, resolveE2EPort } from "../../../e2e/web-port";

/**
 * spyle23/hotelerie#106 — port du serveur web des e2e lu depuis `E2E_PORT` (défaut 3000).
 * Les portes et `resource-lock.mjs run e2e-web` donnent à un worktree de ticket un port propre
 * (3100 + N mod 800) dès que `playwright.config.ts` lit `E2E_PORT`.
 */
describe("resolveE2EPort", () => {
  it("rend 3000 quand E2E_PORT est absent ou vide (AC-2)", () => {
    expect(DEFAULT_E2E_PORT).toBe(3000);
    expect(resolveE2EPort({})).toBe(3000);
    expect(resolveE2EPort({ E2E_PORT: "" })).toBe(3000);
    expect(resolveE2EPort({ E2E_PORT: "  " })).toBe(3000);
  });

  it("rend le port demandé (AC-1)", () => {
    expect(resolveE2EPort({ E2E_PORT: "3257" })).toBe(3257);
    expect(resolveE2EPort({ E2E_PORT: " 3206 " })).toBe(3206);
  });

  it.each(["abc", "32.5", "0", "-1", "70000", "3257x"])(
    "refuse une valeur invalide (%s) au lieu de retomber en silence sur 3000",
    (value) => {
      expect(() => resolveE2EPort({ E2E_PORT: value })).toThrow(/E2E_PORT/);
    },
  );
});

describe("playwright.config.ts", () => {
  const saved = { E2E_PORT: process.env.E2E_PORT, CI: process.env.CI };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.CI;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function loadConfig() {
    const mod = await import("../../../playwright.config");
    return mod.default;
  }

  function webServerOf(config: Awaited<ReturnType<typeof loadConfig>>) {
    const ws = config.webServer;
    if (!ws || Array.isArray(ws)) throw new Error("webServer unique attendu");
    return ws;
  }

  it("E2E_PORT=3257 : serveur, webServer.url et baseURL sur 3257 (AC-1)", async () => {
    process.env.E2E_PORT = "3257";
    const config = await loadConfig();
    const ws = webServerOf(config);

    expect(config.use?.baseURL).toBe("http://localhost:3257");
    expect(ws.url).toBe("http://localhost:3257");
    expect(ws.env?.PORT).toBe("3257");
    expect(ws.command).toBe("yarn dev -p 3257");
  });

  it("E2E_PORT absent : port 3000 et reuseExistingServer inchangés (AC-2)", async () => {
    delete process.env.E2E_PORT;
    const config = await loadConfig();
    const ws = webServerOf(config);

    expect(config.use?.baseURL).toBe("http://localhost:3000");
    expect(ws.url).toBe("http://localhost:3000");
    expect(ws.command).toBe("yarn dev");
    expect(ws.reuseExistingServer).toBe(true);
  });

  it("E2E_PORT défini : reuseExistingServer reste celui de la CI (AC-2)", async () => {
    process.env.E2E_PORT = "3206";
    process.env.CI = "1";
    const ws = webServerOf(await loadConfig());

    expect(ws.reuseExistingServer).toBe(false);
  });
});
