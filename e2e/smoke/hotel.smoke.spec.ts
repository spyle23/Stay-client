import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — fiche hôtel publique (Phase 3, périmètre CLIENT, Story 1.9). Tourne contre le
 * VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000 (module `catalog`) → PMS
 * :5231. Aucune API mockée.
 *
 * La fiche étant **SSR**, c'est le **seul** contexte où elle est rendue avec de vraies données :
 * c'est donc ici — et pas dans l'e2e isolé — que se joue la vérification **axe WCAG 2.1 AA
 * (clair ET sombre)** exigée par l'AC-11, ainsi que les assertions de contenu (prix, galerie,
 * accent hôtel, données structurées).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function searchUrl(): string {
  const params = new URLSearchParams({
    destination: "a",
    checkInDate: futureDate(30),
    checkOutDate: futureDate(33),
    guests: "2",
    currency: "EUR",
  });
  return `/search?${params.toString()}`;
}

test("ouvre une fiche hôtel depuis la recherche via le vrai BFF+PMS (contenu réel, sans erreur)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(searchUrl());
  const firstCard = page.getByTestId("hotel-card").first();
  await expect(firstCard).toBeVisible({ timeout: 20_000 });
  await firstCard.click();

  // Fiche hôtel SSR rendue par le vrai module `catalog`.
  await expect(page).toHaveURL(/\/hotels\//);
  const detail = page.getByTestId("hotel-detail");
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Accent hôtel appliqué sur la surface (AC-5) et galerie rendue (image réelle OU placeholder).
  await expect(detail).toHaveAttribute("data-hotel-theme");
  await expect(page.getByTestId("hotel-gallery")).toBeVisible();
  await expect(page.getByTestId("hotel-location")).toBeVisible();

  // Chambres : le seed expose des chambres réservables → prix affiché (une régression du module
  // `catalog` ne doit PAS pouvoir laisser ce smoke au vert).
  await expect(page.getByTestId("rooms-degraded")).toHaveCount(0);
  const roomCard = page.getByTestId("room-card").first();
  await expect(roomCard).toBeVisible();
  await expect(page.getByTestId("room-card-price").first()).toContainText(/\d/);

  // Données structurées indexables (AC-7) réellement présentes dans le HTML servi.
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLd).toContain('"@type":"Hotel"');
  expect(jsonLd).not.toContain("</script>"); // échappement XSS

  // AC-11 : accessibilité de la fiche, en clair PUIS en sombre.
  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations).toEqual([]);

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations).toEqual([]);

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
