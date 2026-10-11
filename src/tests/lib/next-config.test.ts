import { afterEach, describe, expect, it, vi } from "vitest";

import { E2E_PROD_DIST_DIR } from "../../../e2e/prod-build";

/**
 * `next.config.ts` (spyle23/hotelerie#148) : métadonnées bloquantes pour tous les agents (AC-3) et
 * dossier de build séparé pour l'e2e de production.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function loadConfig() {
  vi.resetModules();
  return import("../../../next.config");
}

describe("next.config — métadonnées et dossier de build (#148)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("les métadonnées bloquent pour un navigateur ordinaire : <title> dans <head>, jamais vide en flux", async () => {
    const { default: config, BLOCKING_METADATA_FOR_ALL_AGENTS } =
      await loadConfig();
    expect(config.htmlLimitedBots).toBe(BLOCKING_METADATA_FOR_ALL_AGENTS);
    expect(BLOCKING_METADATA_FOR_ALL_AGENTS.test(BROWSER_UA)).toBe(true);
    expect(BLOCKING_METADATA_FOR_ALL_AGENTS.test("")).toBe(true);
  });

  it("build dans .next par défaut (portes, Phase 3)", async () => {
    vi.stubEnv("STAY_CLIENT_DIST_DIR", "");
    const { default: config } = await loadConfig();
    expect(config.distDir).toBe(".next");
  });

  it("build de l'e2e de production dans son propre dossier", async () => {
    vi.stubEnv("STAY_CLIENT_DIST_DIR", E2E_PROD_DIST_DIR);
    const { default: config } = await loadConfig();
    expect(config.distDir).toBe(".next-e2e");
  });
});
