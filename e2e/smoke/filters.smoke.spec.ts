import { test, expect } from "@playwright/test";

/**
 * Smoke full-stack — filtres & tri (Phase 3, périmètre CLIENT, story 1.8). Tourne contre le VRAI
 * stack (`scripts/client-stack-up.ps1` : front :3001 → BFF :4000 → PMS :5231). Prouve surtout que
 * les **nouveaux params filtre/tri sont acceptés par le vrai BFF** (le `ValidationPipe`
 * `forbidNonWhitelisted` aurait renvoyé 400 s'ils n'étaient pas déclarés — bug Phase 3 de 1.7).
 */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("les filtres & tri traversent le vrai BFF sans 400/503 ni erreur console", async ({
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
    sort: "price_asc",
    minPrice: "1000",
    minCapacity: "1",
  });
  await page.goto(`/search?${params.toString()}`);

  // La chaîne a répondu si l'on obtient des cartes OU un état vide (filtré ou non) propre.
  await expect(
    page
      .locator(
        '[data-testid="hotel-card"], [data-testid="results-empty"], [data-testid="results-empty-filtered"]',
      )
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // Params filtre/tri acceptés par le vrai BFF : aucun 400 (→ error) ni 503 (→ degraded).
  await expect(page.getByTestId("results-degraded")).toHaveCount(0);
  await expect(page.getByTestId("results-error")).toHaveCount(0);

  // Si des résultats existent, la barre d'outils pilote l'URL contre le vrai stack.
  const toolbar = page.getByTestId("results-toolbar");
  if ((await toolbar.count()) > 0) {
    await expect(toolbar).toBeVisible();
    await page.getByTestId("sort-price_desc").click();
    await expect(page).toHaveURL(/sort=price_desc/);
  }

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
