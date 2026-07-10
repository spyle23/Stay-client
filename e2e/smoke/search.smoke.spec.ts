import { test, expect } from "@playwright/test";

/**
 * Smoke full-stack — recherche multi-hôtels (Phase 3, périmètre CLIENT). Tourne contre le
 * VRAI stack lancé par `scripts/client-stack-up.ps1` : front :3001 → BFF :4000 → PMS :5231.
 * Aucune API mockée. Prouve que le parcours de recherche traverse toute la chaîne.
 */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("la recherche répond depuis le vrai BFF+PMS (hôtels OU état vide), sans dégradation", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const params = new URLSearchParams({
    destination: "a",
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

  // Le vrai BFF+PMS doivent répondre : ni dégradation (503) ni erreur.
  await expect(page.getByTestId("results-degraded")).toHaveCount(0);
  await expect(page.getByTestId("results-error")).toHaveCount(0);

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
