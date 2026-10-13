// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHROMIUM_LAUNCH_ARGS } from "../../../e2e/launch-options";
import { resolveE2EWorkers } from "../../../e2e/workers";

/**
 * spyle23/hotelerie#178 — workers Playwright bornés par `E2E_WORKERS` (budget de l'étape e2e des
 * portes, borne mémoire #177) et navigateurs Chromium sans accélération GPU.
 */
describe("resolveE2EWorkers", () => {
  it("sans E2E_WORKERS (absent ou vide) : valeur actuelle conservée (AC-1)", () => {
    expect(resolveE2EWorkers(4, {})).toBe(4);
    expect(resolveE2EWorkers(4, { E2E_WORKERS: "" })).toBe(4);
    expect(resolveE2EWorkers(4, { E2E_WORKERS: "  " })).toBe(4);
    expect(resolveE2EWorkers(1, {})).toBe(1);
    expect(resolveE2EWorkers(undefined, {})).toBeUndefined();
  });

  it("E2E_WORKERS=n : au plus n workers (AC-1)", () => {
    expect(resolveE2EWorkers(4, { E2E_WORKERS: "1" })).toBe(1);
    expect(resolveE2EWorkers(4, { E2E_WORKERS: " 2 " })).toBe(2);
    // Jamais au-delà de la valeur actuelle : le plafond de la config reste un plafond.
    expect(resolveE2EWorkers(4, { E2E_WORKERS: "8" })).toBe(4);
    expect(resolveE2EWorkers(1, { E2E_WORKERS: "3" })).toBe(1);
    // CI (valeur libre de Playwright) : la borne s'applique telle quelle.
    expect(resolveE2EWorkers(undefined, { E2E_WORKERS: "3" })).toBe(3);
  });

  it.each(["abc", "0", "-1", "2.5", "3x"])(
    "refuse une valeur invalide (%s) au lieu de l'ignorer en silence",
    (value) => {
      expect(() => resolveE2EWorkers(4, { E2E_WORKERS: value })).toThrow(
        /E2E_WORKERS/,
      );
    },
  );
});

describe("configs Playwright (AC-1, AC-2)", () => {
  const KEYS = ["E2E_WORKERS", "CI", "E2E_PORT"] as const;
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

  const CONFIGS = {
    "playwright.config.ts": () => import("../../../playwright.config"),
    "playwright.prod.config.ts": () =>
      import("../../../playwright.prod.config"),
    "playwright.fullstack.config.ts": () =>
      import("../../../playwright.fullstack.config"),
  } as const;
  // Valeurs actuelles (hors CI), à conserver sans E2E_WORKERS.
  const CURRENT = {
    "playwright.config.ts": 4,
    "playwright.prod.config.ts": 1,
    "playwright.fullstack.config.ts": 1,
  } as const;
  const NAMES = Object.keys(CONFIGS) as (keyof typeof CONFIGS)[];

  async function load(name: keyof typeof CONFIGS) {
    return (await CONFIGS[name]()).default;
  }

  it.each(NAMES)("%s : workers inchangés sans E2E_WORKERS", async (name) => {
    expect((await load(name)).workers).toBe(CURRENT[name]);
  });

  it.each(NAMES)("%s : au plus 1 worker avec E2E_WORKERS=1", async (name) => {
    process.env.E2E_WORKERS = "1";
    expect((await load(name)).workers).toBe(1);
  });

  it("playwright.config.ts : E2E_WORKERS=2 donne 2 workers, CI comprise", async () => {
    process.env.E2E_WORKERS = "2";
    expect((await load("playwright.config.ts")).workers).toBe(2);
    vi.resetModules();
    process.env.CI = "1";
    expect((await load("playwright.config.ts")).workers).toBe(2);
  });

  it("playwright.config.ts : en CI sans E2E_WORKERS, Playwright reste libre", async () => {
    process.env.CI = "1";
    expect((await load("playwright.config.ts")).workers).toBeUndefined();
  });

  it.each(NAMES)(
    "%s : chaque projet Chromium est lancé avec --disable-gpu (AC-2)",
    async (name) => {
      const config = await load(name);
      const projects = config.projects ?? [];
      expect(projects.length).toBeGreaterThan(0);
      for (const project of projects) {
        const use = { ...config.use, ...project.use };
        expect(use.launchOptions?.args ?? []).toEqual(
          expect.arrayContaining(["--disable-gpu"]),
        );
      }
    },
  );

  it("les arguments de lancement communs désactivent le GPU", () => {
    expect(CHROMIUM_LAUNCH_ARGS).toContain("--disable-gpu");
  });
});
