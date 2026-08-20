import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const SPA_ID = "55555555-5555-4555-8555-555555555555";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const QUOTE_ROUTE = "**/api/v1/booking/quote**";
const SESSION_ROUTE = "**/api/v1/auth/session";
const RESERVATIONS_ROUTE = "**/api/v1/booking/reservations**";
const UPSELL_ROUTE = "**/api/v1/booking/services**";

function isoDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const checkIn = isoDatePlus(30);
const checkOut = isoDatePlus(32);

function quote() {
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
  };
}

const CATALOG = {
  services: [
    {
      serviceId: SPA_ID,
      name: "Spa",
      description: "Accès illimité",
      unitPrice: 3000,
      currency: "EUR",
      unit: "par séance",
    },
  ],
  degraded: false,
};

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: RESERVATION_ID,
    reservationCode: "RES-20260901-A1B2C",
    status: "Pending",
    hotelId: HOTEL_ID,
    hotelName: "Hôtel Colline",
    roomId: ROOM_ID,
    roomNumber: "204",
    roomCategory: "Double Confort",
    checkInDate: checkIn,
    checkOutDate: checkOut,
    nights: 2,
    guests: 2,
    currency: "EUR",
    pricePerNight: 8400,
    total: 22800,
    roomTotal: 16800,
    servicesTotal: 6000,
    services: [
      {
        lineId: "line-1",
        serviceId: SPA_ID,
        name: "Spa",
        unitPrice: 3000,
        quantity: 2,
        lineTotal: 6000,
        serviceDate: checkIn,
        status: "Pending",
      },
    ],
    holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    specialRequests: null,
    communicationLocale: null,
    communicationLocaleState: "hotel_default_fallback",
    created: true,
    ...overrides,
  };
}

const SESSION_USER = {
  userId: "u-1",
  email: "voyageur@example.com",
  firstName: "Rakoto",
  lastName: "Randria",
};

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(
      status >= 400
        ? { success: false, message: "Erreur" }
        : { success: true, data },
    ),
  });
}

interface Options {
  catalog?: unknown;
  createBody?: Record<string, unknown>;
  onCreate?: (body: Record<string, unknown>) => void;
}

async function mockBff(page: Page, options: Options = {}): Promise<void> {
  await page.route(QUOTE_ROUTE, (route) => json(route, quote()));
  await page.route(UPSELL_ROUTE, (route) =>
    json(route, options.catalog ?? CATALOG),
  );
  await page.route(SESSION_ROUTE, (route) =>
    json(route, { authenticated: true, user: SESSION_USER }),
  );
  await page.route(RESERVATIONS_ROUTE, async (route) => {
    if (route.request().method() === "POST") {
      options.onCreate?.(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      await json(route, options.createBody ?? reservation(), 201);
      return;
    }
    await json(route, options.createBody ?? reservation());
  });
}

function paymentUrl(): string {
  return `/booking/payment?hotelId=${HOTEL_ID}&roomId=${ROOM_ID}&checkInDate=${checkIn}&checkOutDate=${checkOut}&guests=2`;
}

test.describe("Upsell de services (story 2.6)", () => {
  test("propose les services sans rien pré-cocher, et met le total à jour à la sélection", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(paymentUrl());

    const upsell = page.getByTestId("service-upsell");
    await expect(upsell).toBeVisible();

    // Opt-in strict : aucune case cochée à l'arrivée (UX-DR-9.7).
    const toggle = page.getByTestId(`upsell-toggle-${SPA_ID}`);
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("upsell-subtotal")).toContainText(
      "Aucun service",
    );

    await toggle.check();

    // 1 × 30 € : le total de la sélection apparaît immédiatement (anti drip-pricing).
    await expect(page.getByTestId("upsell-subtotal")).toContainText("30");

    await page.getByTestId(`upsell-quantity-${SPA_ID}`).fill("2");
    await expect(page.getByTestId("upsell-subtotal")).toContainText("60");
  });

  test("envoie le panier ET le total combiné au BFF", async ({ page }) => {
    let sent: Record<string, unknown> = {};
    await mockBff(page, { onCreate: (body) => (sent = body) });
    await page.goto(paymentUrl());

    await page.getByTestId(`upsell-toggle-${SPA_ID}`).check();
    await page.getByTestId(`upsell-quantity-${SPA_ID}`).fill("2");
    await page.getByTestId("payment-create-cta").click();

    await expect(page.getByTestId("payment-attached-services")).toBeVisible();

    // Le total annoncé DOIT inclure les services : envoyer le seul total chambre ferait refuser
    // la création en `price-changed` côté BFF.
    expect(sent.expectedTotal).toBe(22_800);
    expect(sent.services).toEqual([
      { serviceId: SPA_ID, quantity: 2, serviceDate: checkIn },
    ]);
  });

  test("n’envoie AUCUNE clé `services` quand rien n’est sélectionné", async ({
    page,
  }) => {
    let sent: Record<string, unknown> = {};
    await mockBff(page, {
      onCreate: (body) => (sent = body),
      createBody: reservation({
        total: 16800,
        servicesTotal: 0,
        services: [],
      }),
    });
    await page.goto(paymentUrl());

    await page.getByTestId("payment-create-cta").click();
    await expect(page.getByTestId("payment-reservation-code")).toBeVisible();

    expect(sent).not.toHaveProperty("services");
    expect(sent.expectedTotal).toBe(16_800);
  });

  test("tait la section quand le catalogue est vide ou dégradé", async ({
    page,
  }) => {
    await mockBff(page, { catalog: { services: [], degraded: true } });
    await page.goto(paymentUrl());

    // Le tunnel reste ouvert : on ne montre pas une section vide, et surtout on n'affirme pas
    // « aucun service » quand on n'en sait rien.
    await expect(page.getByTestId("service-upsell")).toHaveCount(0);
    await expect(page.getByTestId("payment-create-cta")).toBeEnabled();
  });

  test("affiche les services attachés après création, en lecture seule", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(paymentUrl());

    await page.getByTestId(`upsell-toggle-${SPA_ID}`).check();
    await page.getByTestId("payment-create-cta").click();

    const attached = page.getByTestId("payment-attached-services");
    await expect(attached).toBeVisible();
    await expect(attached).toContainText("Spa");
    // Aucune commande d'édition : la modification passe par un appel dédié, refusé dès qu'un
    // paiement est engagé.
    await expect(attached.getByRole("checkbox")).toHaveCount(0);
  });

  test("annonce explicitement un service retiré, sans faire échouer la chambre", async ({
    page,
  }) => {
    await mockBff(page, {
      createBody: reservation({
        total: 16800,
        servicesTotal: 0,
        services: [
          {
            lineId: "line-1",
            serviceId: SPA_ID,
            name: "Spa",
            unitPrice: 3000,
            quantity: 2,
            lineTotal: 6000,
            serviceDate: checkIn,
            status: "Cancelled",
          },
        ],
      }),
    });
    await page.goto(paymentUrl());

    await page.getByTestId(`upsell-toggle-${SPA_ID}`).check();
    await page.getByTestId("payment-create-cta").click();

    // La réservation aboutit ; le retrait est dit, pas tu (AC-6).
    await expect(page.getByTestId("payment-reservation-code")).toBeVisible();
    await expect(page.getByTestId("payment-dropped-services")).toBeVisible();
  });

  test("axe : l’étape paiement avec upsell reste conforme WCAG 2.1 AA", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(paymentUrl());
    await page.getByTestId(`upsell-toggle-${SPA_ID}`).check();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
