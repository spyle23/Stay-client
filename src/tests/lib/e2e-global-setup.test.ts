// @vitest-environment node
import path from "node:path";

import type { FullConfig } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * spyle23/hotelerie#198 AC-1 — global setup des e2e isolés : chaque route de `src/app` est demandée
 * une fois au serveur avant le premier test, et la durée est journalisée.
 */

const warmupE2EServer = vi.fn();

vi.mock("../../../e2e/warmup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../e2e/warmup")>();
  return { ...actual, warmupE2EServer };
});

function configWith(baseURL: string | undefined): FullConfig {
  return { projects: [{ use: { baseURL } }] } as unknown as FullConfig;
}

describe("e2e/global-setup (#198 AC-1)", () => {
  const savedWarmup = process.env.E2E_WARMUP;
  let output: string[];

  beforeEach(() => {
    delete process.env.E2E_WARMUP;
    warmupE2EServer.mockReset();
    output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedWarmup === undefined) delete process.env.E2E_WARMUP;
    else process.env.E2E_WARMUP = savedWarmup;
  });

  it("préchauffe toutes les routes de src/app sur le baseURL et journalise leur nombre et la durée", async () => {
    warmupE2EServer.mockResolvedValue({
      routes: 0,
      failed: [],
      durationMs: 12_345,
    });
    const { warmupRoutes } = await import("../../../e2e/warmup");
    const expected = warmupRoutes(path.resolve(__dirname, "../../app"));
    const { default: globalSetup } = await import("../../../e2e/global-setup");

    await globalSetup(configWith("http://localhost:3298"));

    expect(warmupE2EServer).toHaveBeenCalledTimes(1);
    const [{ baseURL, routes }] = warmupE2EServer.mock.calls[0] as [
      { baseURL: string; routes: string[] },
    ];
    expect(baseURL).toBe("http://localhost:3298");
    expect(routes).toEqual(expected);
    expect(routes).toContain("/booking/payment");
    expect(routes).toContain("/booking/recap");
    expect(output.join("")).toBe(
      `[e2e warmup] ${expected.length} routes compilees en 12.3 s\n`,
    );
  });

  it("signale les routes en erreur sans faire échouer la suite", async () => {
    warmupE2EServer.mockResolvedValue({
      routes: 0,
      failed: ["/booking/payment", "/search"],
      durationMs: 800,
    });
    const { default: globalSetup } = await import("../../../e2e/global-setup");

    await expect(
      globalSetup(configWith("http://localhost:3000")),
    ).resolves.toBeUndefined();

    expect(output.join("")).toMatch(
      /routes compilees en 0\.8 s ; en erreur : \/booking\/payment, \/search\n$/,
    );
  });

  it("E2E_WARMUP=0 : aucune requête, désactivation annoncée", async () => {
    process.env.E2E_WARMUP = "0";
    const { default: globalSetup } = await import("../../../e2e/global-setup");

    await globalSetup(configWith("http://localhost:3000"));

    expect(warmupE2EServer).not.toHaveBeenCalled();
    expect(output.join("")).toBe("[e2e warmup] desactive (E2E_WARMUP=0)\n");
  });

  it("sans baseURL : aucune requête", async () => {
    const { default: globalSetup } = await import("../../../e2e/global-setup");

    await globalSetup(configWith(undefined));

    expect(warmupE2EServer).not.toHaveBeenCalled();
  });
});
