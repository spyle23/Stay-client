// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  E2E_DEV_SERVER_ENV,
  E2E_PAGES_BUFFER_LENGTH,
  E2E_PAGES_MAX_INACTIVE_AGE_MS,
  e2eDevServerOverrides,
} from "../../lib/e2e-dev-server";

/**
 * spyle23/hotelerie#190 — serveur des e2e isolés en `next dev` **sans Turbopack**.
 *
 * Sous Next 16, `next dev` utilise Turbopack par défaut ; sur la machine de dev (16 Go), il
 * engendrait des centaines de workers `.next/dev` (559 sous #183, 675 sous #177) jusqu'à
 * l'épuisement de la mémoire. Les e2e passent donc par un script dédié (`dev:e2e`, webpack) ;
 * `yarn dev` (usage interactif) et la production (`next build` / `next start`, Phase 3) restent
 * inchangés.
 */
const ROOT = join(__dirname, "..", "..", "..");

type PackageJson = { scripts: Record<string, string> };

function scripts(): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as PackageJson;
  return pkg.scripts;
}

describe("scripts du package (AC-1, AC-5)", () => {
  it("dev:e2e lance next dev avec webpack, jamais Turbopack", () => {
    const devE2e = scripts()["dev:e2e"];
    expect(devE2e).toBe("next dev --webpack");
    expect(devE2e).not.toMatch(/--turbo/);
  });

  it("yarn dev (usage interactif) est inchangé", () => {
    expect(scripts().dev).toBe("next dev");
  });

  it("build et start (production, Phase 3) sont inchangés", () => {
    expect(scripts().build).toBe("next build");
    expect(scripts().start).toBe("next start");
  });
});

describe("serveurs web des configs Playwright (AC-1, AC-5)", () => {
  const KEYS = ["E2E_PORT", "CI"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    vi.resetModules();
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function webServerOf(config: { webServer?: unknown }) {
    const ws = config.webServer;
    if (!ws || Array.isArray(ws)) throw new Error("webServer unique attendu");
    return ws as { command: string; env?: Record<string, string> };
  }

  it("e2e isolés : dev:e2e sur le port du ticket, PORT conservé", async () => {
    process.env.E2E_PORT = "3290";
    const ws = webServerOf(
      (await import("../../../playwright.config")).default,
    );

    expect(ws.command).toBe("yarn dev:e2e -p 3290");
    expect(ws.env?.PORT).toBe("3290");
  });

  it("e2e isolés sans E2E_PORT : dev:e2e sur 3000", async () => {
    const ws = webServerOf(
      (await import("../../../playwright.config")).default,
    );

    expect(ws.command).toBe("yarn dev:e2e");
    expect(ws.env?.PORT).toBe("3000");
  });

  it("e2e isolés : jamais le script interactif ni Turbopack", async () => {
    process.env.E2E_PORT = "3290";
    const ws = webServerOf(
      (await import("../../../playwright.config")).default,
    );

    expect(ws.command).not.toMatch(/\byarn dev(?!:e2e)\b/);
    expect(ws.command).not.toMatch(/--turbo/);
  });

  it("e2e de production : build et next start inchangés (AC-5)", async () => {
    process.env.E2E_PORT = "3290";
    const ws = webServerOf(
      (await import("../../../playwright.prod.config")).default,
    );

    expect(ws.command).toBe("yarn build && yarn start -p 3290");
  });
});

/**
 * spyle23/hotelerie#198 — routes compilées avant le premier test (global setup) et gardées
 * compilées pendant toute la suite (`onDemandEntries` du serveur des e2e seulement).
 */
describe("préchauffage du serveur des e2e isolés (#198)", () => {
  const KEYS = ["E2E_PORT", "CI"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    vi.resetModules();
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("e2e isolés : global setup de préchauffage (AC-1)", async () => {
    const config = (await import("../../../playwright.config")).default;

    expect(config.globalSetup).toBe("./e2e/global-setup.ts");
  });

  it("e2e isolés : le serveur web garde ses routes compilées (E2E dev server)", async () => {
    process.env.E2E_PORT = "3298";
    const config = (await import("../../../playwright.config")).default;
    const ws = config.webServer as { env?: Record<string, string> };

    expect(ws.env?.[E2E_DEV_SERVER_ENV]).toBe("1");
    expect(ws.env?.PORT).toBe("3298");
  });

  it("e2e de production : ni préchauffage ni réglage du serveur de dev", async () => {
    const config = (await import("../../../playwright.prod.config")).default;
    const ws = config.webServer as { env?: Record<string, string> };

    expect(config.globalSetup).toBeUndefined();
    expect(ws.env?.[E2E_DEV_SERVER_ENV]).toBeUndefined();
  });
});

describe("e2eDevServerOverrides (#198)", () => {
  it("rien hors du serveur des e2e (yarn dev, build, Phase 3)", () => {
    expect(e2eDevServerOverrides({})).toEqual({});
    expect(e2eDevServerOverrides({ [E2E_DEV_SERVER_ENV]: "0" })).toEqual({});
  });

  it("serveur des e2e : aucune route libérée pendant la suite", () => {
    expect(e2eDevServerOverrides({ [E2E_DEV_SERVER_ENV]: "1" })).toEqual({
      onDemandEntries: {
        maxInactiveAge: E2E_PAGES_MAX_INACTIVE_AGE_MS,
        pagesBufferLength: E2E_PAGES_BUFFER_LENGTH,
      },
    });
    expect(E2E_PAGES_MAX_INACTIVE_AGE_MS).toBeGreaterThanOrEqual(
      30 * 60 * 1000,
    );
    expect(E2E_PAGES_BUFFER_LENGTH).toBeGreaterThan(100);
  });
});
