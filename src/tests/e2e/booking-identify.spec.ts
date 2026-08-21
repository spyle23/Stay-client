import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const QUOTE_ROUTE = "**/api/v1/booking/quote**";
const SESSION_ROUTE = "**/api/v1/auth/session";
const GUEST_ROUTE = "**/api/v1/auth/guest";

/** Date-only UTC décalée de `days` jours (les dates passées sont rejetées à la validation). */
function isoDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const checkIn = isoDatePlus(30);
const checkOut = isoDatePlus(32);

const GUEST = {
  firstName: "Hery",
  lastName: "Rakoto",
  email: "invite@example.com",
  phone: "+261340000000",
};

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

async function mockBff(
  page: Page,
  options: {
    quoteBody?: Record<string, unknown>;
    quoteStatus?: number;
    sessionStatus?: number;
    authenticated?: boolean;
    guestStatus?: number;
  } = {},
): Promise<void> {
  await page.route(QUOTE_ROUTE, (route) =>
    json(route, options.quoteBody ?? quote(), options.quoteStatus ?? 200),
  );
  await page.route(SESSION_ROUTE, (route) =>
    json(
      route,
      options.authenticated
        ? { authenticated: true, user: SESSION_USER }
        : { authenticated: false, user: null },
      options.sessionStatus ?? 200,
    ),
  );
  await page.route(GUEST_ROUTE, (route) =>
    json(
      route,
      {
        authenticated: true,
        user: { ...SESSION_USER, email: GUEST.email },
      },
      options.guestStatus ?? 200,
    ),
  );
}

function identifyUrl(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    hotelId: HOTEL_ID,
    roomId: ROOM_ID,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    guests: "2",
    currency: "EUR",
    ...params,
  });
  return `/booking/identify?${query.toString()}`;
}

async function fillGuestForm(page: Page): Promise<void> {
  await page.getByTestId("guest-first-name").fill(GUEST.firstName);
  await page.getByTestId("guest-last-name").fill(GUEST.lastName);
  await page.getByTestId("guest-email").fill(GUEST.email);
  await page.getByTestId("guest-phone").fill(GUEST.phone);
}

/**
 * E2E **isolé** de l'identification (story 2.3, FR-8). Le BFF est intercepté par `page.route` :
 * aucun PMS, aucun compte réellement créé. Le happy-path contre le vrai stack est couvert par
 * `e2e/smoke/booking-identify.smoke.spec.ts`.
 */
test.describe("Identification invité ou compte (isolé, BFF mocké)", () => {
  test("invité par défaut : le formulaire est proposé sans inscription forcée", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(identifyUrl());

    await expect(page.getByTestId("guest-form")).toBeVisible();
    await expect(page.getByTestId("identify-tab-guest")).toHaveAttribute(
      "data-active",
      "",
    );
    // Le récapitulatif reste visible pendant l'identification (UX-DR-2.5).
    await expect(page.getByTestId("booking-summary")).toBeVisible();
  });

  test("le Checkout invité mène au paiement en conservant le contexte", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(identifyUrl());
    await fillGuestForm(page);

    await page.getByTestId("guest-submit").click();

    await expect(page).toHaveURL(/\/booking\/payment\?/);
    await expect(page).toHaveURL(new RegExp(`hotelId=${HOTEL_ID}`));
    await expect(page).toHaveURL(new RegExp(`roomId=${ROOM_ID}`));
    await expect(page).toHaveURL(/guests=2/);
    // La route existe : aucun lien mort (AC-8). Depuis la story 2.4 elle porte l'étape réelle de
    // création, et la session ouverte par le Checkout invité y donne directement accès (la
    // navigation reste côté client : le cache de session survit).
    await expect(page.getByTestId("payment-create-cta")).toBeVisible();
  });

  test("aucun mot de passe n’est transmis par le navigateur", async ({
    page,
  }) => {
    await mockBff(page);
    const bodies: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/auth/guest")) {
        bodies.push(request.postData() ?? "");
      }
    });
    await page.goto(identifyUrl());
    await fillGuestForm(page);
    await page.getByTestId("guest-submit").click();
    await expect(page).toHaveURL(/\/booking\/payment/);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/password/i);
    expect(JSON.parse(bodies[0])).toEqual(GUEST);
  });

  test("collision d’email : bascule sur l’onglet compte, email pré-rempli, sortie proposée", async ({
    page,
  }) => {
    await mockBff(page, { guestStatus: 409 });
    await page.goto(identifyUrl());
    await fillGuestForm(page);

    await page.getByTestId("guest-submit").click();

    await expect(page.getByTestId("guest-email-conflict")).toBeVisible();
    await expect(page.getByTestId("login-email")).toHaveValue(GUEST.email);
    // Jamais de cul-de-sac : se connecter OU changer d'adresse (AC-7).
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByTestId("guest-use-another-email")).toBeVisible();
    await expect(page).toHaveURL(/\/booking\/identify/);

    await page.getByTestId("guest-use-another-email").click();
    await expect(page.getByTestId("guest-form")).toBeVisible();
    await expect(page.getByTestId("guest-email")).toHaveValue("");
  });

  test("voyageur connecté : identité pré-remplie, aucun formulaire invité", async ({
    page,
  }) => {
    await mockBff(page, { authenticated: true });
    await page.goto(identifyUrl());

    await expect(page.getByTestId("identify-signed-in")).toBeVisible();
    await expect(page.getByTestId("identify-identity")).toContainText(
      "voyageur@example.com",
    );
    await expect(page.getByTestId("guest-form")).toHaveCount(0);
    await expect(page.getByTestId("identify-switch-account")).toBeVisible();

    await page.getByTestId("identify-continue").click();
    await expect(page).toHaveURL(/\/booking\/payment\?/);
  });

  test("URL de tunnel invalide : état d’invalidité SANS aucun appel BFF", async ({
    page,
  }) => {
    let bffCalls = 0;
    await page.route("**/api/v1/**", async (route: Route) => {
      bffCalls += 1;
      await json(route, {});
    });

    await page.goto(identifyUrl({ checkInDate: "", checkOutDate: "" }));

    await expect(page.getByTestId("booking-invalid")).toBeVisible();
    await expect(page.getByTestId("guest-form")).toHaveCount(0);
    await expect(page.getByTestId("booking-invalid-cta")).toBeVisible();
    expect(bffCalls).toBe(0);
  });

  test("dépassement de capacité : soumission neutralisée et porte de sortie", async ({
    page,
  }) => {
    await mockBff(page, {
      quoteBody: quote({ guests: 4, roomCapacity: 2, available: false }),
    });
    await page.goto(identifyUrl({ guests: "4" }));

    await expect(page.getByTestId("identify-blocked")).toBeVisible();
    await expect(page.getByTestId("guest-submit")).toBeDisabled();
    await expect(page.getByTestId("identify-blocked-exit")).toBeVisible();
  });

  test("retour non destructif vers le récapitulatif", async ({ page }) => {
    await mockBff(page);
    await page.goto(identifyUrl());

    await page.getByTestId("identify-back-to-recap").click();

    await expect(page).toHaveURL(/\/booking\/recap\?/);
    await expect(page).toHaveURL(new RegExp(`roomId=${ROOM_ID}`));
    await expect(page.getByTestId("booking-summary")).toBeVisible();
  });

  /**
   * ⚠️ L'ordre compte : `page.reload()` réinitialise l'onglet (`useState`), donc auditer le mode
   * sombre après un rechargement ne peut **jamais** atteindre l'onglet compte. On bascule le
   * thème d'abord, puis on parcourt les deux onglets — les 4 combinaisons sont réellement vues.
   */
  for (const scheme of ["light", "dark"] as const) {
    test(`axe : identification sans violation en thème ${scheme}, sur les DEUX onglets`, async ({
      page,
    }) => {
      await mockBff(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(identifyUrl());
      await expect(page.getByTestId("guest-form")).toBeVisible();

      const guest = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(guest.violations).toEqual([]);

      await page.getByTestId("identify-tab-account").click();
      await expect(page.getByTestId("login-form")).toBeVisible();
      const account = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(account.violations).toEqual([]);
    });
  }

  /**
   * Les surfaces d'alerte (`warning-soft`, `destructive`) sont les plus exposées au contraste et
   * n'étaient auditées nulle part : un audit du seul état nominal ne les voit jamais.
   */
  test("axe : alerte de collision et blocage de séjour, clair + sombre", async ({
    page,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });

      // Collision d'email → bandeau `warning` + formulaire de connexion.
      await mockBff(page, { guestStatus: 409 });
      await page.goto(identifyUrl());
      await fillGuestForm(page);
      await page.getByTestId("guest-submit").click();
      await expect(page.getByTestId("guest-email-conflict")).toBeVisible();
      const conflict = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(conflict.violations, `collision (${scheme})`).toEqual([]);

      // Séjour bloqué → bandeau `warning` + porte de sortie.
      await page.unrouteAll();
      await mockBff(page, {
        quoteBody: quote({ guests: 4, roomCapacity: 2, available: false }),
      });
      await page.goto(identifyUrl({ guests: "4" }));
      await expect(page.getByTestId("identify-blocked")).toBeVisible();
      const blocked = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(blocked.violations, `blocage (${scheme})`).toEqual([]);
      await page.unrouteAll();
    }
  });

  test("axe : devis en erreur et panne de session, thème sombre", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockBff(page, { quoteStatus: 500 });
    await page.goto(identifyUrl());
    await expect(page.getByTestId("identify-quote-error")).toBeVisible();

    const quoteError = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(quoteError.violations).toEqual([]);

    await page.unrouteAll();
    await mockBff(page, { sessionStatus: 503 });
    await page.goto(identifyUrl());
    await expect(page.getByTestId("identify-session-error")).toBeVisible();

    const sessionError = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(sessionError.violations).toEqual([]);
  });

  /**
   * La bascule automatique vers l'onglet compte démonte le panneau invité (`keepMounted: false`) :
   * l'élément focalisé disparaît. Sans repli explicite, le focus retombe sur `<body>` et un
   * utilisateur au clavier perd sa position juste après une erreur — `axe` ne voit pas ce défaut.
   */
  test("le focus ne retombe pas sur body après la bascule automatique", async ({
    page,
  }) => {
    await mockBff(page, { guestStatus: 409 });
    await page.goto(identifyUrl());
    await fillGuestForm(page);
    await page.getByTestId("guest-submit").click();
    await expect(page.getByTestId("guest-email-conflict")).toBeVisible();

    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).not.toBe("BODY");
  });

  test("« utiliser une autre adresse » redonne le focus au champ email", async ({
    page,
  }) => {
    await mockBff(page, { guestStatus: 409 });
    await page.goto(identifyUrl());
    await fillGuestForm(page);
    await page.getByTestId("guest-submit").click();
    await page.getByTestId("guest-use-another-email").click();

    await expect(page.getByTestId("guest-email")).toBeFocused();
  });

  test("devis en erreur : état explicite, sortie, et soumission neutralisée", async ({
    page,
  }) => {
    await mockBff(page, { quoteStatus: 500 });
    await page.goto(identifyUrl());

    await expect(page.getByTestId("identify-quote-error")).toBeVisible();
    await expect(page.getByTestId("identify-quote-exit")).toBeVisible();
    await expect(page.getByTestId("guest-submit")).toBeDisabled();
    await expect(
      page.getByTestId("identify-summary-unavailable"),
    ).toBeVisible();
  });

  test("panne de session : ni formulaire invité, ni panneau connecté", async ({
    page,
  }) => {
    await mockBff(page, { sessionStatus: 503 });
    await page.goto(identifyUrl());

    await expect(page.getByTestId("identify-session-error")).toBeVisible();
    await expect(page.getByTestId("guest-form")).toHaveCount(0);
    await expect(page.getByTestId("identify-signed-in")).toHaveCount(0);
  });

  test("mobile : CTA pleine largeur et cibles tactiles ≥ 44 px", async ({
    page,
  }) => {
    await mockBff(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(identifyUrl());
    await expect(page.getByTestId("guest-form")).toBeVisible();

    // `axe` ne couvre pas ce critère (WCAG 2.5.5/2.5.8) — 5 régressions à 32 px en revue 2.2.
    for (const id of [
      "identify-tab-guest",
      "identify-tab-account",
      "guest-email",
      "guest-submit",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `cible ${id} mesurable`).not.toBeNull();
      expect(box!.height, `cible ${id} ≥ 44 px`).toBeGreaterThanOrEqual(44);
    }

    const submit = await page.getByTestId("guest-submit").boundingBox();
    expect(submit!.width).toBeGreaterThan(300);
  });
});
