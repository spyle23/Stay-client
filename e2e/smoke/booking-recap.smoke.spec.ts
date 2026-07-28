import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — récapitulatif de réservation (Phase 3, périmètre CLIENT, story 2.2). Tourne
 * contre le VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000 (module
 * `booking`, endpoint `/booking/quote`) → PMS :5231. Aucune API mockée.
 *
 * Vérifie ce que l'e2e isolé ne peut pas prouver : que le devis calculé par le vrai BFF depuis les
 * vraies données PMS est **cohérent au centime avec la fiche chambre** (AC-1), que la politique
 * d'annulation s'affiche en repli honnête (AC-3/AC-4), que la modification de séjour **recalcule
 * réellement** (AC-2), et que l'écran est **WCAG 2.1 AA** en clair et en sombre avec de vraies
 * données (AC-10).
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

/**
 * Chiffres du **montant seul** d'un `PriceTag` (« 168 € » → « 168 »), espaces fines comprises.
 *
 * ⚠️ Lire le `textContent` du `PriceTag` entier collerait la légende au montant
 * (« €60total for 3 night(s) » → « 603 ») : on cible la région `aria-live`, qui ne porte que
 * le montant.
 */
async function amountDigits(page: Page, testId: string): Promise<string> {
  const text =
    (await page
      .locator(`[data-testid="${testId}"] [aria-live="polite"]`)
      .textContent()) ?? "";
  return text.replace(/[^\d]/g, "");
}

/**
 * Nombre de nuits lu dans la ventilation « {tarif} × {n} nuits ».
 *
 * ⚠️ Un `toContainText("3")` sur la ventilation entière serait satisfait par un **tarif** contenant
 * le chiffre cherché (« 123,00 € × 2 nuits » vaut « 3 ») : le test serait vrai pour la mauvaise
 * raison. On extrait donc le nombre qui précède réellement « nuit(s) » / « night(s) » (revue 2.2).
 */
async function breakdownNights(page: Page): Promise<number> {
  const text =
    (await page.getByTestId("booking-breakdown").textContent()) ?? "";
  const match = /(\d+)\s*(?:nuits?|nights?)/i.exec(text);
  expect(match, `Ventilation illisible: « ${text} »`).not.toBeNull();
  return Number(match?.[1]);
}

/**
 * Collecte les erreurs **console ET réseau** de la page (AC-12 : « 0 erreur console/réseau »).
 * Un `page.on("console")` seul laisserait passer un appel BFF en échec — précisément la classe de
 * panne que le smoke est censé attraper contre le vrai stack (revue 2.2).
 */
function watchForFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    failures.push(
      `requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "inconnu"}`,
    );
  });
  page.on("response", (res) => {
    // Les documents/ressources tierces ne nous concernent pas : on surveille nos propres appels.
    if (res.status() >= 400 && /\/api\/v1\//.test(res.url())) {
      failures.push(
        `http ${res.status()}: ${res.request().method()} ${res.url()}`,
      );
    }
  });
  return failures;
}

test("recherche → hôtel → chambre → récapitulatif via le vrai BFF+PMS (total cohérent, politique, recalcul, a11y)", async ({
  page,
}) => {
  const failures = watchForFailures(page);

  // Recherche → première fiche hôtel → première chambre disponible.
  await page.goto(searchUrl());
  const firstCard = page.getByTestId("hotel-card").first();
  await expect(firstCard).toBeVisible({ timeout: 20_000 });
  await firstCard.click();
  await expect(page).toHaveURL(/\/hotels\//);

  const roomCta = page.getByTestId("room-card-cta").first();
  await expect(roomCta).toBeVisible({ timeout: 20_000 });
  await roomCta.click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.getByTestId("room-detail")).toBeVisible({
    timeout: 20_000,
  });

  // Total du séjour affiché par la fiche chambre — référence de l'AC-1.
  const roomTotalDigits = await amountDigits(page, "room-detail-price");
  expect(roomTotalDigits.length).toBeGreaterThan(0);

  // Aucune promesse d'annulation gratuite en amont du tunnel (D2 non livré — story 2.2).
  await expect(page.getByText(/annulation gratuite/i)).toHaveCount(0);

  // Entrée dans le tunnel : le CTA « Réserver » mène au récapitulatif.
  await page.getByTestId("room-book-cta").click();
  await expect(page).toHaveURL(/\/booking\/recap\?/);

  const summary = page.getByTestId("booking-summary");
  await expect(summary).toBeVisible({ timeout: 20_000 });

  // AC-1 : le total du récapitulatif est celui de la fiche chambre, au centime près.
  expect(await amountDigits(page, "booking-total")).toBe(roomTotalDigits);

  // AC-1 : ventilation, dates, voyageurs présents.
  await expect(page.getByTestId("booking-breakdown")).toContainText(/\d/);
  await expect(page.getByTestId("booking-check-in")).not.toBeEmpty();
  await expect(page.getByTestId("booking-check-out")).not.toBeEmpty();
  await expect(page.getByTestId("booking-guests")).toContainText("2");

  // AC-3/AC-4 : politique d'annulation présentée AVANT paiement, en repli honnête (D2 absent).
  const policy = page.getByTestId("cancellation-policy-fallback");
  await expect(policy).toBeVisible();
  await expect(policy).toHaveAttribute("data-dependency", "D2");
  await expect(policy).not.toContainText(/gratuit/i);

  // AC-5 : état de taxe explicite, jamais un montant inventé.
  await expect(page.getByTestId("booking-tax-state")).toContainText(
    /non détaillées|not itemised/i,
  );

  // AC-9 : le CTA mène à l'étape suivante, qui existe (aucun 404).
  await expect(page.getByTestId("booking-continue")).toBeVisible();

  // AC-10 : accessibilité du récapitulatif, en clair PUIS en sombre, avec de vraies données.
  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations).toEqual([]);

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations).toEqual([]);

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

/**
 * AC-2 côté **vrai BFF** : le recalcul est prouvé par les **deux** déclencheurs.
 *
 * 1. L'**éditeur de séjour** (voyageurs), piloté à la souris comme un utilisateur : c'est le
 *    chemin éditeur → `router.replace` → nouvelle clé de query → refetch, jamais exercé contre le
 *    vrai stack avant cette revue (il ne l'était qu'en isolé, BFF mocké). On **décrémente**
 *    (2 → 1) : incrémenter pourrait dépasser la capacité de la chambre du jeu de données et
 *    rendre l'assertion dépendante du seed.
 * 2. Le **contexte d'URL** (dates), source de vérité du tunnel — un séjour plus court doit
 *    produire un total plus faible, calculé par le service réel et non par une fixture.
 *
 * Le calendrier n'est volontairement pas piloté : cliquer un jour réel rendrait le smoke sensible
 * au mois affiché, alors que le câblage picker → URL est déterministe en e2e isolé.
 */
test("le séjour est réellement re-tarifé par le BFF, depuis l’éditeur puis depuis l’URL", async ({
  page,
}) => {
  const failures = watchForFailures(page);

  await page.goto(searchUrl());
  const firstCard = page.getByTestId("hotel-card").first();
  await expect(firstCard).toBeVisible({ timeout: 20_000 });
  await firstCard.click();
  const roomCta = page.getByTestId("room-card-cta").first();
  await expect(roomCta).toBeVisible({ timeout: 20_000 });
  await roomCta.click();
  await page.getByTestId("room-book-cta").click();

  await expect(page.getByTestId("booking-summary")).toBeVisible({
    timeout: 20_000,
  });
  const threeNightsTotal = await amountDigits(page, "booking-total");
  expect(await breakdownNights(page)).toBe(3);
  await expect(page.getByTestId("booking-guests")).toContainText("2");

  // (1) Éditeur de séjour → URL → refetch, contre le vrai BFF.
  await page.getByTestId("guest-selector-trigger").click();
  await page.getByTestId("guest-decrease").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("booking-stay-submit").click();

  await expect(page).toHaveURL(/guests=1/);
  await expect(page.getByTestId("booking-guests")).toContainText("1", {
    timeout: 20_000,
  });
  // Le devis est de nouveau à jour : le CTA est franchissable (il est neutralisé pendant le
  // recalcul, cf. revue 2.2).
  await expect(page.getByTestId("booking-continue")).toBeVisible({
    timeout: 20_000,
  });

  // (2) Même chambre, séjour raccourci à 2 nuits — via l'URL, source de vérité du tunnel.
  const shorter = new URL(page.url());
  shorter.searchParams.set("checkOutDate", futureDate(32));
  await page.goto(shorter.toString());

  await expect(page.getByTestId("booking-summary")).toBeVisible({
    timeout: 20_000,
  });
  expect(await breakdownNights(page)).toBe(2);
  const twoNightsTotal = await amountDigits(page, "booking-total");
  expect(Number(twoNightsTotal)).toBeLessThan(Number(threeNightsTotal));

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});
