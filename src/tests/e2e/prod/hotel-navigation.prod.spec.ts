import { test, expect, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mockHotelSearch, sampleHotel } from "../helpers/mock-api";

/**
 * E2E isolé **en production** (`next start`, spyle23/hotelerie#148) : navigation carte → fiche hôtel
 * pendant que Next.js précharge les liens de la grille.
 *
 * Cause (AC-1) : la carte d'hôtel est cliquée pendant le préchargement « jusqu'au squelette »
 * (`loading.tsx`) de sa fiche. Si ce préchargement se termine **avant** la réponse du fetch RSC de
 * navigation (requête en file derrière les préchargements de la grille, serveur ou réseau lent),
 * le routeur de Next 16.2 valide la navigation (URL, titre, annonce de route) sur le segment de page
 * vide du préchargement et n'y écrit plus la réponse dynamique : en-tête seul, fiche blanche.
 * Personne n'annule le fetch : le `net::ERR_ABORTED` vu par Playwright est la fin normale d'une
 * réponse lue en flux (statut 200 reçu).
 *
 * Ici, l'API est sur un port fermé (#95) : la recherche est simulée par `page.route`, la fiche est
 * rendue côté serveur dans son état dégradé (« Hôtel indisponible »). Une page blanche n'affiche
 * jamais cet état.
 */
const GUID_PREFIX = "3fa85f64-5717-4562-b3fc-2c963f66af";
const HOTEL_COUNT = 9;

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function searchUrl(): string {
  const params = new URLSearchParams({
    destination: "Paris",
    checkInDate: futureDate(30),
    checkOutDate: futureDate(33),
    guests: "2",
    currency: "EUR",
  });
  return `/search?${params.toString()}`;
}

async function mockGrid(page: Page): Promise<void> {
  await mockHotelSearch(page, {
    hotels: Array.from({ length: HOTEL_COUNT }, (_, i) =>
      sampleHotel({ hotelId: `${GUID_PREFIX}${10 + i}`, name: `Hôtel ${i}` }),
    ),
  });
}

/** Fetch RSC de **navigation** vers une fiche hôtel (ni préchargement, ni document). */
function isHotelNavigationRsc(request: Request): boolean {
  const headers = request.headers();
  return (
    request.url().includes("/hotels/") &&
    new URL(request.url()).searchParams.has("_rsc") &&
    headers["next-router-prefetch"] === undefined &&
    headers["next-router-segment-prefetch"] === undefined
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe("Fiche hôtel en production — navigation pendant les préchargements (#148)", () => {
  test("clic immédiat sur une carte, réponse de navigation après les préchargements : jamais de page blanche", async ({
    page,
  }) => {
    // Trois passages : avant correctif, la fiche restait blanche ~5 fois sur 6.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockGrid(page);
      // La réponse de navigation arrive après les préchargements (file d'attente du navigateur).
      await page.route(/[?&]_rsc=/, async (route) => {
        if (isHotelNavigationRsc(route.request())) await sleep(3_000);
        await route.continue().catch(() => undefined);
      });

      await page.goto(searchUrl());
      const card = page.getByTestId("hotel-card").first();
      await expect(card).toBeVisible();
      await card.click();

      await expect(page).toHaveURL(/\/hotels\//);
      await expect(
        page.getByTestId("hotel-degraded"),
        `passage ${attempt + 1} : fiche hôtel blanche après le clic`,
      ).toBeVisible({ timeout: 15_000 });
      // État d'erreur avec une sortie (AC-2).
      await expect(page.getByTestId("hotel-degraded-cta")).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("fetch RSC de navigation interrompu : la fiche est servie par le navigateur, pas une page vide", async ({
    page,
  }) => {
    await mockGrid(page);
    await page.route(/[?&]_rsc=/, async (route) => {
      if (isHotelNavigationRsc(route.request())) {
        await route.abort("aborted");
        return;
      }
      await route.continue().catch(() => undefined);
    });

    await page.goto(searchUrl());
    const card = page.getByTestId("hotel-card").first();
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(/\/hotels\//);
    await expect(page.getByTestId("hotel-degraded")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Titre du document en production (#148, AC-3)", () => {
  test("le <title> de la fiche hôtel est dans <head> dès le DOMContentLoaded et axe document-title passe", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __titleAtDcl: string | null }).__titleAtDcl =
          document.head.querySelector("title")?.textContent ?? null;
      });
    });
    await page.goto(
      `/hotels/hotel-${GUID_PREFIX}10?checkInDate=${futureDate(30)}&checkOutDate=${futureDate(33)}&guests=2`,
    );
    await expect(page.getByTestId("hotel-degraded")).toBeVisible();

    const titleAtDcl = await page.evaluate(
      () => (window as unknown as { __titleAtDcl: string | null }).__titleAtDcl,
    );
    expect(titleAtDcl?.trim()).toBeTruthy();

    const audit = await new AxeBuilder({ page })
      .withRules(["document-title"])
      .analyze();
    expect(audit.violations).toEqual([]);
  });

  test("le <title> de la fiche chambre est dans <head> dès le DOMContentLoaded et axe document-title passe", async ({
    page,
  }) => {
    // QA #148 : AC-3 vise la fiche chambre comme la fiche hôtel (échec d'origine : room.smoke.spec.ts).
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __titleAtDcl: string | null }).__titleAtDcl =
          document.head.querySelector("title")?.textContent ?? null;
      });
    });
    await page.goto(
      `/hotels/hotel-${GUID_PREFIX}10/rooms/11111111-1111-1111-1111-111111111111?checkInDate=${futureDate(30)}&checkOutDate=${futureDate(33)}&guests=2`,
    );
    await expect(page.getByTestId("room-degraded")).toBeVisible();

    const titleAtDcl = await page.evaluate(
      () => (window as unknown as { __titleAtDcl: string | null }).__titleAtDcl,
    );
    expect(titleAtDcl?.trim()).toBeTruthy();

    const audit = await new AxeBuilder({ page })
      .withRules(["document-title"])
      .analyze();
    expect(audit.violations).toEqual([]);
  });

  test("le titre n'est jamais vide pendant la navigation recherche → fiche hôtel", async ({
    page,
  }) => {
    await mockGrid(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __emptyTitleFrames: number };
      w.__emptyTitleFrames = 0;
      const tick = () => {
        if (document.readyState !== "loading" && document.title === "") {
          w.__emptyTitleFrames += 1;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(searchUrl());
    const card = page.getByTestId("hotel-card").first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId("hotel-degraded")).toBeVisible({
      timeout: 15_000,
    });
    await sleep(300);

    const emptyFrames = await page.evaluate(
      () =>
        (window as unknown as { __emptyTitleFrames: number })
          .__emptyTitleFrames,
    );
    expect(emptyFrames).toBe(0);
  });
});
