import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — fiche chambre publique (Phase 3, périmètre CLIENT, Story 1.10). Tourne contre
 * le VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000 (module `catalog`,
 * endpoint room-detail) → PMS :5231. Aucune API mockée.
 *
 * La fiche étant **SSR**, c'est le **seul** contexte où elle est rendue avec de vraies données :
 * c'est donc ici — et pas dans l'e2e isolé — que se joue la vérification **axe WCAG 2.1 AA
 * (clair ET sombre)** exigée par l'AC-11, le parcours **recherche → hôtel → fiche → tunnel**
 * (AC-1/AC-3/AC-4), et les assertions de contenu (prix, galerie, données structurées).
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

test("recherche → hôtel → fiche chambre via le vrai BFF+PMS (contenu réel, CTA tunnel, sans erreur)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Recherche → première fiche hôtel.
  await page.goto(searchUrl());
  const firstCard = page.getByTestId("hotel-card").first();
  await expect(firstCard).toBeVisible({ timeout: 20_000 });
  await firstCard.click();
  await expect(page).toHaveURL(/\/hotels\//);

  // Le CTA de la RoomCard (câblé en 1.10) est un lien vers la fiche chambre (AC-4).
  const roomCta = page.getByTestId("room-card-cta").first();
  await expect(roomCta).toBeVisible({ timeout: 20_000 });
  const roomHref = await roomCta.getAttribute("href");
  expect(roomHref).toContain("/rooms/");
  await roomCta.click();

  // Fiche chambre SSR rendue par le vrai endpoint room-detail.
  await expect(page).toHaveURL(/\/rooms\//);
  const detail = page.getByTestId("room-detail");
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Accent hôtel (AC-7), galerie (image réelle OU placeholder), prix affiché.
  await expect(detail).toHaveAttribute("data-hotel-theme");
  await expect(page.getByTestId("hotel-gallery")).toBeVisible();
  await expect(page.getByTestId("room-detail-price")).toContainText(/\d/);

  // Chambre issue de la liste « disponibles » → CTA « Réserver » actif vers le tunnel (AC-3).
  const bookCta = page.getByTestId("room-book-cta");
  await expect(bookCta).toBeVisible();
  expect(await bookCta.getAttribute("href")).toContain("/booking");

  // Données structurées indexables (AC-10) réellement présentes et échappées.
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLd).toContain('"@type":"HotelRoom"');
  expect(jsonLd).not.toContain("</script>");

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
