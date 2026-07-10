import { test, expect } from "@playwright/test";

/**
 * Smoke full-stack — recherche « à proximité » (Phase 3, périmètre CLIENT, FR-2). Tourne contre
 * le VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000 → PMS :5231. Navigue
 * directement sur l'URL de proximité (pas de permission géoloc requise) et prouve que la chaîne
 * `GET /api/v1/search/hotels/nearby` traverse toute la chaîne, sans dégradation.
 */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("la recherche à proximité répond depuis le vrai BFF+PMS (hôtels OU état vide), sans dégradation", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const params = new URLSearchParams({
    mode: "nearby",
    // Antananarivo (proche des hôtels seedés en dev) — rayon par défaut côté BFF.
    latitude: "-18.879",
    longitude: "47.508",
    checkInDate: futureDate(30),
    checkOutDate: futureDate(33),
    guests: "2",
    currency: "EUR",
  });
  await page.goto(`/search?${params.toString()}`);

  // La chaîne a répondu si l'on obtient soit des cartes, soit un état vide propre.
  await expect(
    page
      .locator('[data-testid="hotel-card"], [data-testid="results-empty"]')
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("results-degraded")).toHaveCount(0);
  await expect(page.getByTestId("results-error")).toHaveCount(0);

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
