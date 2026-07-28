import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { buildBookingUrl } from "@/services/catalog.service";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const QUOTE_ROUTE = "**/api/v1/booking/quote**";

/** Date-only UTC décalée de `days` jours (les dates passées sont rejetées à la validation). */
function isoDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const checkIn = isoDatePlus(30);
const checkOut = isoDatePlus(32);

function quote(overrides: Record<string, unknown> = {}) {
  return {
    hotelId: HOTEL_ID,
    hotelName: "Hôtel Colline",
    hotelCity: "Antananarivo",
    hotelLogoUrl: null,
    roomId: ROOM_ID,
    roomNumber: "204",
    roomCategory: "Double Confort",
    roomCapacity: 2,
    roomImageUrl: null,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    nights: 2,
    guests: 2,
    currency: "EUR",
    pricePerNight: 8400,
    roomTotal: 16800,
    taxAmount: null,
    taxState: "included_undetailed",
    total: 16800,
    available: true,
    availabilityDegraded: false,
    cancellationPolicy: {
      source: "fallback",
      refundable: null,
      freeUntil: null,
      terms: null,
    },
    quotedAt: "2999-07-01T10:00:00Z",
    ...overrides,
  };
}

async function mockQuote(
  page: Page,
  options: { body?: Record<string, unknown>; status?: number } = {},
): Promise<void> {
  await page.route(QUOTE_ROUTE, async (route: Route) => {
    const status = options.status ?? 200;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status >= 400
          ? { success: false, message: "Erreur" }
          : { success: true, data: options.body ?? quote() },
      ),
    });
  });
}

function recapUrl(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    hotelId: HOTEL_ID,
    roomId: ROOM_ID,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    guests: "2",
    currency: "EUR",
    ...params,
  });
  return `/booking/recap?${query.toString()}`;
}

/**
 * E2E **isolé** du récapitulatif (story 2.2, FR-7). Le devis est demandé côté navigateur →
 * `page.route` l'intercepte, sans BFF ni PMS réel. Le happy-path contre de vraies données est
 * couvert par le smoke (`e2e/smoke/booking-recap.smoke.spec.ts`).
 */
test.describe("Récapitulatif de réservation (isolé, BFF mocké)", () => {
  test("affiche le récapitulatif complet, politique en repli comprise", async ({
    page,
  }) => {
    await mockQuote(page);
    await page.goto(recapUrl());

    await expect(page.getByTestId("booking-summary")).toBeVisible();
    await expect(page.getByTestId("booking-total")).toContainText("168");
    await expect(page.getByTestId("booking-room")).toContainText(
      "Double Confort",
    );
    await expect(page.getByTestId("booking-guests")).toContainText(
      "2 voyageurs",
    );
    await expect(
      page.getByTestId("cancellation-policy-fallback"),
    ).toBeVisible();
    // Aucune promesse d'annulation gratuite tant que D2 n'est pas livré.
    await expect(page.getByText(/annulation gratuite/i)).toHaveCount(0);
  });

  test("le CTA mène à l’étape d’identification (pas de 404) en conservant le contexte", async ({
    page,
  }) => {
    await mockQuote(page);
    // L'étape d'identification (story 2.3) lit la session : sans mock, la requête partirait
    // vers un BFF absent et l'écran afficherait un état d'erreur au lieu du formulaire.
    await page.route("**/api/v1/auth/session", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { authenticated: false, user: null },
        }),
      });
    });
    await page.goto(recapUrl());

    await page.getByTestId("booking-continue").click();
    await expect(page).toHaveURL(/\/booking\/identify\?/);
    await expect(page).toHaveURL(new RegExp(`hotelId=${HOTEL_ID}`));
    await expect(page).toHaveURL(new RegExp(`roomId=${ROOM_ID}`));
    await expect(page).toHaveURL(/guests=2/);
    await expect(page.getByTestId("guest-form")).toBeVisible();
  });

  test("/booking redirige vers /booking/recap sans perdre la query", async ({
    page,
  }) => {
    await mockQuote(page);
    const query = new URLSearchParams({
      hotelId: HOTEL_ID,
      roomId: ROOM_ID,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests: "2",
      currency: "EUR",
    });
    await page.goto(`/booking?${query.toString()}`);

    await expect(page).toHaveURL(/\/booking\/recap\?/);
    await expect(page).toHaveURL(new RegExp(`roomId=${ROOM_ID}`));
    await expect(page.getByTestId("booking-summary")).toBeVisible();
  });

  /** AC-8 : une URL invalide n'entraîne AUCUN appel BFF (garde côté page). */
  test("une URL de tunnel invalide rend l’état d’invalidité sans aucun appel BFF", async ({
    page,
  }) => {
    let quoteCalls = 0;
    await page.route(QUOTE_ROUTE, async (route: Route) => {
      quoteCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: quote() }),
      });
    });

    await page.goto(recapUrl({ checkInDate: "", checkOutDate: "" }));

    await expect(page.getByTestId("booking-invalid")).toBeVisible();
    await expect(page.getByTestId("booking-summary")).toHaveCount(0);
    await expect(page.getByTestId("booking-invalid-cta")).toBeVisible();
    expect(quoteCalls).toBe(0);
  });

  /**
   * Décision de revue 2.2 : un dépassement de capacité est déterministe, pas une incertitude PMS.
   * Il bloque donc le CTA **même** quand la disponibilité est dégradée — sans quoi le tunnel mène
   * à une création vouée à l'échec, après l'étape d'identification.
   */
  test("dépassement de capacité : CTA bloqué même en disponibilité dégradée", async ({
    page,
  }) => {
    await mockQuote(page, {
      body: quote({
        guests: 4,
        roomCapacity: 2,
        available: false,
        availabilityDegraded: true,
      }),
    });
    await page.goto(recapUrl({ guests: "4" }));

    await expect(page.getByTestId("booking-over-capacity")).toBeVisible();
    await expect(page.getByTestId("booking-continue-disabled")).toBeDisabled();
    await expect(page.getByTestId("booking-continue")).toHaveCount(0);
    // La dégradation ne doit toujours pas s'afficher « indisponible » (AC-7 intact).
    await expect(page.getByTestId("booking-unavailable")).toHaveCount(0);
  });

  test("chambre indisponible : CTA désactivé et porte de sortie vers l’hôtel", async ({
    page,
  }) => {
    await mockQuote(page, {
      body: quote({ available: false, availabilityDegraded: false }),
    });
    await page.goto(recapUrl());

    await expect(page.getByTestId("booking-unavailable")).toBeVisible();
    await expect(page.getByTestId("booking-continue-disabled")).toBeDisabled();
    await expect(page.getByTestId("booking-continue")).toHaveCount(0);
    await expect(page.getByTestId("booking-unavailable-exit")).toBeVisible();
  });

  test("modifier le nombre de voyageurs recalcule le total et met l’URL à jour", async ({
    page,
  }) => {
    await page.route(QUOTE_ROUTE, async (route: Route) => {
      const guests = new URL(route.request().url()).searchParams.get("guests");
      // Le devis à 3 voyageurs porte un total DIFFÉRENT : renvoyer le même montant rendrait le
      // recalcul inobservable et le test vrai pour la mauvaise raison (revue 2.2).
      const body =
        guests === "3"
          ? quote({
              guests: 3,
              // Capacité 4 : ce test porte sur le **recalcul**, pas sur le dépassement de
              // capacité (couvert par son propre test) — une chambre de 2 bloquerait le CTA.
              roomCapacity: 4,
              pricePerNight: 10_500,
              roomTotal: 21_000,
              total: 21_000,
            })
          : quote({ roomCapacity: 4 });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: body }),
      });
    });
    await page.goto(recapUrl());
    await expect(page.getByTestId("booking-guests")).toContainText(
      "2 voyageurs",
    );
    await expect(page.getByTestId("booking-total")).toContainText("168");

    await page.getByTestId("guest-selector-trigger").click();
    await page.getByTestId("guest-increase").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("booking-stay-submit").click();

    await expect(page).toHaveURL(/guests=3/);
    await expect(page.getByTestId("booking-guests")).toContainText(
      "3 voyageurs",
    );
    // Le NOUVEAU total est bien celui affiché — pas le précédent conservé par `keepPreviousData`.
    await expect(page.getByTestId("booking-total")).toContainText("210");
    // Et le CTA est de nouveau franchissable une fois le devis à jour.
    await expect(page.getByTestId("booking-continue")).toBeVisible();
  });

  /**
   * AC-9 / revue 2.2 : le parcours réel commence à la fiche chambre. Ce test part du **deep-link
   * émis par `buildBookingUrl`** plutôt que d'un `page.goto` direct sur le récapitulatif — sans
   * quoi une régression du handoff 1.10 (query tronquée, mauvaise route) passerait inaperçue en
   * isolé et ne serait rattrapée que par le smoke.
   */
  test("deep-link de la fiche chambre : le contexte arrive intact au récapitulatif", async ({
    page,
  }) => {
    await mockQuote(page);

    // L'URL est produite par la MÊME fonction que le CTA « Réserver » de la fiche chambre : si
    // `buildBookingUrl` régressait (route, clé de query, devise perdue), ce test tomberait.
    const handoff = buildBookingUrl(HOTEL_ID, ROOM_ID, {
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests: 2,
      currency: "EUR",
    });

    await page.goto(handoff);

    await expect(page).toHaveURL(/\/booking\/recap\?/);
    await expect(page).toHaveURL(new RegExp(`hotelId=${HOTEL_ID}`));
    await expect(page).toHaveURL(new RegExp(`roomId=${ROOM_ID}`));
    await expect(page.getByTestId("booking-summary")).toBeVisible();
  });

  test("mobile : le récapitulatif est une barre repliable dépliable au tap", async ({
    page,
  }) => {
    await mockQuote(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(recapUrl());

    const toggle = page.getByTestId("booking-summary-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("booking-summary-panel")).toBeHidden();

    // AC-3 : la politique d'annulation et l'état de disponibilité restent lisibles SANS
    // interaction, même quand le détail est replié — ils vivent hors du panneau (revue 2.2).
    await expect(page.getByTestId("booking-summary-essentials")).toBeVisible();
    await expect(
      page.getByTestId("cancellation-policy-fallback"),
    ).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("booking-summary-panel")).toBeVisible();
  });

  /**
   * Revue 2.2 : un audit axe au seul viewport desktop ne voit jamais l'état replié — c'est-à-dire
   * exactement la surface que voit un utilisateur mobile.
   */
  test("axe : barre mobile repliée sans violation", async ({ page }) => {
    await mockQuote(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(recapUrl());
    await expect(page.getByTestId("booking-summary-toggle")).toBeVisible();

    const collapsed = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(collapsed.violations).toEqual([]);
  });

  test("axe : récapitulatif sans violation, clair + sombre", async ({
    page,
  }) => {
    await mockQuote(page);
    await page.goto(recapUrl());
    await expect(page.getByTestId("booking-summary")).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});
