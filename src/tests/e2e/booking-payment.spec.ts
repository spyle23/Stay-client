import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ROOM_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const QUOTE_ROUTE = "**/api/v1/booking/quote**";
const SESSION_ROUTE = "**/api/v1/auth/session";
const RESERVATIONS_ROUTE = "**/api/v1/booking/reservations**";
const UPSELL_ROUTE = "**/api/v1/booking/services**";
/** Story 3.1 — demande de PaymentIntent, émise dès que la vue devient `payable`. */
const INTENT_ROUTE = "**/api/v1/payment/reservations/*/intent";

/**
 * Stub de Stripe.js : juste assez pour que `loadStripe` résolve et que la sonde de payabilité
 * réponde. Le parcours d'autorisation RÉEL est couvert par le smoke full-stack, contre le vrai
 * Stripe — ici, on ne teste que notre propre logique d'écran.
 */
const STRIPE_JS_STUB = `window.Stripe = function () {
  return {
    elements: function () {
      return { create: function () { return { mount: function () {}, on: function () {}, destroy: function () {} }; }, getElement: function () { return null; }, update: function () {} };
    },
    retrievePaymentIntent: function () {
      return Promise.resolve({ paymentIntent: { status: 'requires_payment_method' } });
    },
    confirmPayment: function () {
      return Promise.resolve({ error: { message: 'stub' } });
    },
  };
};`;

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

const SESSION_USER = {
  userId: "u-1",
  email: "voyageur@example.com",
  firstName: "Rakoto",
  lastName: "Randria",
};

/** Hold à +10 min : actif pendant le test, sans déborder le plafond de `setTimeout`. */
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
    total: 16800,
    // Story 2.6 — présents dans le contrat réel du BFF, comme les champs de la story 2.5.
    roomTotal: 16800,
    servicesTotal: 0,
    services: [],
    holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    // Story 2.5 — toujours présents dans le contrat réel du BFF (jamais `undefined`) : une fixture
    // qui les omettrait ferait passer des tests sur un corps que le BFF n'émet pas.
    specialRequests: null,
    communicationLocale: null,
    communicationLocaleState: "hotel_default_fallback",
    created: true,
    ...overrides,
  };
}

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

/** Une réponse de création : succès (corps) ou refus (statut + motif machine). */
interface CreateOutcome {
  status?: number;
  errors?: Record<string, string[]>;
  body?: Record<string, unknown>;
}

interface BffOptions {
  quoteBody?: Record<string, unknown>;
  quoteStatus?: number;
  authenticated?: boolean;
  sessionStatus?: number;
  createStatus?: number;
  createBody?: Record<string, unknown>;
  createErrors?: Record<string, string[]>;
  /** Réponses successives aux créations — c'est ce qui permet d'enchaîner refus puis acceptation. */
  createSequence?: CreateOutcome[];
  createDelayMs?: number;
  /** Catalogue d'upsell servi par le BFF (story 2.6). Vide par défaut. */
  upsellBody?: Record<string, unknown>;
  getBody?: Record<string, unknown>;
  getStatus?: number;
  /** Story 3.1 — réponse du BFF à la demande de PaymentIntent. */
  intentBody?: Record<string, unknown>;
  intentStatus?: number;
}

async function fulfillCreate(route: Route, outcome: CreateOutcome) {
  const status = outcome.status ?? 201;
  if (status >= 400) {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        // Texte technique du BFF : il ne doit JAMAIS apparaître à l'écran.
        message: "Refus du BFF",
        errors: outcome.errors ?? {},
      }),
    });
    return;
  }
  await json(route, outcome.body ?? reservation(), status);
}

async function mockBff(page: Page, options: BffOptions = {}): Promise<void> {
  // ⚠️ Stripe.js est routé vers un stub : sans cela, la suite « isolée » sortait réellement sur
  // Internet dès qu'un scénario devenait payable (`PayableGate` appelle `loadStripe` au montage).
  // Une suite isolée qui dépend d'un service tiers n'est plus isolée — et devient rouge le jour où
  // le réseau l'est. Exigé par la story, absent jusqu'à la revue de code.
  await page.route("https://js.stripe.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: STRIPE_JS_STUB,
    }),
  );

  // Story 3.1 : la fente de paiement demande un intent dès qu'elle se monte. Sans cette route, la
  // requête partirait vers un BFF absent et chaque test « payable » afficherait un état d'erreur.
  await page.route(INTENT_ROUTE, (route) =>
    // ⚠️ Pas `json()` : ce helper remplace le corps par un message générique dès 400, ce qui
    // effacerait `errors.reason` — précisément ce que ces scénarios doivent transporter.
    route.fulfill({
      status: options.intentStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.intentBody ?? {
          success: true,
          data: {
            clientSecret: "pi_e2e_secret_abc123",
            publishableKey: "pk_test_e2e",
            paymentIntentId: "pi_e2e",
            amount: 16_800,
            currency: "EUR",
            captureMethod: "manual",
          },
        },
      ),
    }),
  );
  await page.route(QUOTE_ROUTE, (route) =>
    json(route, options.quoteBody ?? quote(), options.quoteStatus ?? 200),
  );
  await page.route(UPSELL_ROUTE, (route) =>
    json(route, options.upsellBody ?? { services: [], degraded: false }),
  );
  await page.route(SESSION_ROUTE, (route) =>
    json(
      route,
      {
        authenticated: options.authenticated ?? true,
        user: options.authenticated === false ? null : SESSION_USER,
      },
      options.sessionStatus ?? 200,
    ),
  );

  let attempt = 0;
  await page.route(RESERVATIONS_ROUTE, async (route) => {
    if (route.request().method() === "POST") {
      if (options.createDelayMs !== undefined) {
        await new Promise((r) => setTimeout(r, options.createDelayMs));
      }
      const outcome =
        options.createSequence?.[
          Math.min(attempt, options.createSequence.length - 1)
        ] ??
        ({
          status: options.createStatus ?? 201,
          errors: options.createErrors,
          body: options.createBody,
        } satisfies CreateOutcome);
      attempt++;
      await fulfillCreate(route, outcome);
      return;
    }
    await json(
      route,
      options.getBody ?? reservation({ created: false }),
      options.getStatus ?? 200,
    );
  });
}

function paymentUrl(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    hotelId: HOTEL_ID,
    roomId: ROOM_ID,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    guests: "2",
    currency: "EUR",
    ...params,
  });
  return `/booking/payment?${query.toString()}`;
}

/** Compte les créations réellement émises par le navigateur (invariant « aucune au montage »). */
function watchCreations(page: Page): string[] {
  const creations: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/api/v1/booking/reservations")
    ) {
      creations.push(req.postData() ?? "");
    }
  });
  return creations;
}

/**
 * Étape de création de la Réservation `Pending` (story 2.4, FR-9) — e2e **isolé** : le BFF est
 * intercepté (`page.route`), aucun vrai stack n'est requis. Le parcours contre le vrai BFF est
 * couvert par `e2e/smoke/booking-payment.smoke.spec.ts`.
 */
test.describe("Tunnel — création de la réservation", () => {
  test("crée la réservation sur action explicite et affiche le code", async ({
    page,
  }) => {
    await mockBff(page);
    const creations = watchCreations(page);

    await page.goto(paymentUrl());
    await expect(page.getByTestId("payment-create-cta")).toBeVisible();
    // Aucune création au montage : un rafraîchissement ne doit jamais geler une chambre de plus.
    expect(creations).toHaveLength(0);

    await page.getByTestId("payment-create-cta").click();

    await expect(page.getByTestId("payment-reservation-code")).toHaveText(
      "RES-20260901-A1B2C",
    );
    await expect(page.getByTestId("payment-hold-active")).toBeVisible();
    expect(creations).toHaveLength(1);
    // Le montant opposé au PMS est celui affiché (AC-2).
    expect(JSON.parse(creations[0])).toMatchObject({ expectedTotal: 16800 });
    // L'identifiant rejoint l'URL : c'est ce qui rendra la reprise possible.
    await expect(page).toHaveURL(new RegExp(`reservationId=${RESERVATION_ID}`));
  });

  test("le récapitulatif reste persistant à l’étape de création", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(paymentUrl());
    await expect(page.getByTestId("booking-summary")).toBeVisible();
  });

  test("annonce « aucun débit » avant la création", async ({ page }) => {
    await mockBff(page);
    await page.goto(paymentUrl());
    await expect(page.getByTestId("payment-no-charge-notice")).toBeVisible();
  });

  test("relit la réservation de l’URL sans en créer une seconde", async ({
    page,
  }) => {
    await mockBff(page);
    const creations = watchCreations(page);

    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    const panel = page.getByTestId("payment-reservation-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-status", "Pending");
    await expect(panel).toHaveAttribute("data-view", "payable");
    expect(creations).toHaveLength(0);
    // Le retour à l'identification reste adressable sur la `Pending` déjà créée.
    await expect(page.getByTestId("payment-back-to-identify")).toHaveAttribute(
      "href",
      new RegExp(`reservationId=${RESERVATION_ID}`),
    );
  });

  test("neutralise l’action quand la chambre est indisponible, et offre une issue", async ({
    page,
  }) => {
    await mockBff(page, { quoteBody: quote({ available: false }) });
    await page.goto(paymentUrl());

    await expect(page.getByTestId("payment-blocked")).toBeVisible();
    await expect(page.getByTestId("payment-create-cta")).toBeDisabled();
    await expect(page.getByTestId("payment-blocked-exit")).toBeVisible();
  });

  test("renvoie à l’identification quand la session n’est plus active", async ({
    page,
  }) => {
    await mockBff(page, { authenticated: false });
    await page.goto(paymentUrl());

    await expect(page.getByTestId("payment-must-identify")).toBeVisible();
    await expect(page.getByTestId("payment-create-cta")).toHaveCount(0);
  });

  /**
   * Devis en erreur : l'écran doit le DIRE et offrir une issue (UX-DR-4.5). Sans ce bandeau, le
   * CTA neutralisé par `quoteUnknown` était un cul-de-sac muet à l'étape la plus critique.
   */
  test("devis en panne : bandeau explicatif, rejeu et sortie", async ({
    page,
  }) => {
    await mockBff(page, { quoteStatus: 503 });
    await page.goto(paymentUrl());

    await expect(page.getByTestId("payment-quote-error")).toBeVisible();
    await expect(page.getByTestId("payment-quote-retry")).toBeVisible();
    await expect(page.getByTestId("payment-quote-exit")).toBeVisible();
    await expect(page.getByTestId("payment-create-cta")).toBeDisabled();
  });

  test("devis refusé (4xx) : sortie seule, aucun rejeu condamné d’avance", async ({
    page,
  }) => {
    await mockBff(page, { quoteStatus: 404 });
    await page.goto(paymentUrl());

    await expect(page.getByTestId("payment-quote-error")).toBeVisible();
    await expect(page.getByTestId("payment-quote-retry")).toHaveCount(0);
    await expect(page.getByTestId("payment-quote-exit")).toBeVisible();
  });

  /**
   * `disabled` pendant l'appel sortirait le CTA du tab order (focus retombé sur `<body>`) : le
   * blocage transitoire est un `aria-disabled` doublé d'une garde de clic.
   */
  test("pendant l’appel : CTA hors d’usage mais toujours focalisable, sans double création", async ({
    page,
  }) => {
    await mockBff(page, { createDelayMs: 1_500 });
    const creations = watchCreations(page);
    await page.goto(paymentUrl());

    const cta = page.getByTestId("payment-create-cta");
    await cta.click();

    await expect(cta).toHaveAttribute("aria-disabled", "true");
    // `toBeDisabled()` de Playwright considère `aria-disabled="true"` comme désactivé : l'employer
    // ici testerait l'inverse de ce que l'on veut. Ce qui compte est que l'attribut **natif**
    // `disabled` soit absent — c'est lui qui sortirait le bouton de l'ordre de tabulation et ferait
    // retomber le focus sur `<body>` en plein appel (défaut relevé en revue 2.4).
    await expect(cta).not.toHaveAttribute("disabled", /.*/);
    await cta.focus();
    await expect(cta).toBeFocused();
    await cta.click({ force: true });

    await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();
    expect(creations).toHaveLength(1);
  });

  test("indisponibilité de dernière minute : message et sortie, sans « Réessayer »", async ({
    page,
  }) => {
    await mockBff(page, {
      createStatus: 409,
      createErrors: { reason: ["room-unavailable"] },
    });
    await page.goto(paymentUrl());
    await page.getByTestId("payment-create-cta").click();

    const failure = page.getByTestId("payment-failure");
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute("data-reason", "room-unavailable");
    await expect(page.getByTestId("payment-failure-other-rooms")).toBeVisible();
    // Un refus déterministe ne se rejoue pas : proposer « Réessayer » serait un cul-de-sac.
    await expect(page.getByTestId("payment-failure-retry")).toHaveCount(0);
    // Le CTA de création est neutralisé aussi : le laisser actif rouvrirait le même cul-de-sac.
    await expect(page.getByTestId("payment-create-cta")).toBeDisabled();
    // Le texte technique du BFF ne franchit jamais l'écran.
    await expect(failure).not.toContainText("Refus du BFF");
  });

  /** `rejected` : refus **déterministe** non qualifié (tout 4xx PMS que le BFF n'a pas su classer). */
  test("refus non qualifié : aucune invitation à réessayer, mais une issue", async ({
    page,
  }) => {
    await mockBff(page, {
      createStatus: 400,
      createErrors: { reason: ["rejected"] },
    });
    await page.goto(paymentUrl());
    await page.getByTestId("payment-create-cta").click();

    const failure = page.getByTestId("payment-failure");
    await expect(failure).toHaveAttribute("data-reason", "rejected");
    await expect(page.getByTestId("payment-failure-retry")).toHaveCount(0);
    await expect(
      page.getByTestId("payment-failure-back-to-recap"),
    ).toBeVisible();
  });

  /** Une limitation de débit doit offrir une issue — sa barre d'actions était vide. */
  test("limitation de débit : issues praticables, sans rejeu immédiat", async ({
    page,
  }) => {
    await mockBff(page, { createStatus: 429 });
    await page.goto(paymentUrl());
    await page.getByTestId("payment-create-cta").click();

    const failure = page.getByTestId("payment-failure");
    await expect(failure).toHaveAttribute("data-reason", "rate-limited");
    await expect(page.getByTestId("payment-failure-retry")).toHaveCount(0);
    await expect(page.getByTestId("payment-failure-other-rooms")).toBeVisible();
    await expect(
      page.getByTestId("payment-failure-back-to-recap"),
    ).toBeVisible();
  });

  /**
   * Le `role="alert"` a été retiré du panneau (inséré avec son élément, il n'annonce pas de façon
   * fiable) : l'annonce passe par la région `aria-live` **montée en permanence**, et le focus
   * amène le clavier au message — le CTA vient de sortir d'usage.
   */
  test("un échec est annoncé par la région permanente et reçoit le focus", async ({
    page,
  }) => {
    await mockBff(page, {
      createStatus: 409,
      createErrors: { reason: ["room-unavailable"] },
    });
    await page.goto(paymentUrl());
    await page.getByTestId("payment-create-cta").click();

    const failure = page.getByTestId("payment-failure");
    await expect(failure).toBeVisible();
    await expect(failure).not.toHaveAttribute("role", "alert");
    await expect(failure).toBeFocused();
    await expect(page.getByTestId("payment-status-announcement")).toContainText(
      /vient d’être réservée/,
    );
  });

  /**
   * ⚠️ Le bloquant que l'assertion de présence laissait passer : re-soumettre l'ANCIEN total
   * faisait recréer, diverger, annuler puis refuser en 409 — indéfiniment, avec une `Cancelled`
   * de plus dans le PMS partagé à chaque clic. Le bouton est donc **cliqué**, et c'est le corps de
   * la seconde requête qui est prouvé.
   */
  test("changement de tarif : la re-confirmation soumet le NOUVEAU total", async ({
    page,
  }) => {
    await mockBff(page, {
      createSequence: [
        {
          status: 409,
          errors: {
            reason: ["price-changed"],
            total: ["17000"],
            currency: ["EUR"],
          },
        },
        { status: 201, body: reservation({ total: 17000 }) },
      ],
    });
    const creations = watchCreations(page);
    await page.goto(paymentUrl());
    await page.getByTestId("payment-create-cta").click();

    const failure = page.getByTestId("payment-failure");
    await expect(failure).toHaveAttribute("data-reason", "price-changed");
    await expect(failure).toContainText("170");
    // Le récapitulatif chiffre encore l'ancien total : l'écran le dit plutôt que d'afficher deux
    // montants contradictoires avant paiement.
    await expect(page.getByTestId("payment-summary-outdated")).toBeVisible();

    await page.getByTestId("payment-failure-confirm-price").click();

    await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();
    await expect(page.getByTestId("payment-failure")).toHaveCount(0);
    expect(creations).toHaveLength(2);
    expect(JSON.parse(creations[0])).toMatchObject({ expectedTotal: 16800 });
    // Sans ce total-là, la boucle 409 était infinie.
    expect(JSON.parse(creations[1])).toMatchObject({
      expectedTotal: 17000,
      expectedCurrency: "EUR",
    });
  });

  /**
   * ⚠️ Le second bloquant invisible : `router.replace` ne change que des query-params et ne
   * démonte pas l'île cliente. Sans `create.reset()`, le même panneau se réaffichait
   * indéfiniment. Le bouton est **cliqué**, et le retour à l'écran de création est prouvé.
   */
  test("hold expiré : la reprise ramène réellement à l’écran de création", async ({
    page,
  }) => {
    await mockBff(page, {
      getBody: reservation({ created: false, holdExpiresAt: null }),
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await expect(page.getByTestId("payment-hold-expired")).toBeVisible();
    await expect(page.getByTestId("payment-element-placeholder")).toHaveCount(
      0,
    );

    await page.getByTestId("payment-hold-restart").click();

    const createPanel = page.getByTestId("payment-create-panel");
    await expect(createPanel).toBeVisible();
    await expect(page.getByTestId("payment-reservation-panel")).toHaveCount(0);
    await expect(page.getByTestId("payment-hold-expired")).toHaveCount(0);
    // L'URL repart sans identifiant : la reprise ne doit pas relire la réservation périmée.
    await expect(page).not.toHaveURL(/reservationId=/);
    await expect(page.getByTestId("payment-create-cta")).toBeEnabled();
    // Le bouton qui portait le focus vient d'être démonté : sans repli, le focus retomberait sur
    // `<body>`. Assertion tenue **ici** et non en intégration : la reprise passe par un
    // `requestAnimationFrame`, dont l'ordonnancement n'est déterministe que dans un vrai navigateur.
    await expect(createPanel).toBeFocused();
  });

  test("une URL de tunnel invalide n’émet aucun appel BFF côté navigateur", async ({
    page,
  }) => {
    let bffCalls = 0;
    await page.route("**/api/v1/**", (route) => {
      bffCalls++;
      return route.abort();
    });

    await page.goto("/booking/payment?hotelId=pas-un-guid");

    await expect(page.getByTestId("booking-invalid")).toBeVisible();
    // ⚠️ Portée réelle : `page.route` n'intercepte pas les requêtes émises depuis les Server
    // Components. Ce test prouve l'absence d'appel **côté client** ; la garde SSR, elle, est
    // vérifiée par le rendu de l'état d'invalidité.
    expect(bffCalls).toBe(0);
  });
});

test.describe("Tunnel — statut réel de la réservation relue", () => {
  for (const [status, view, marker] of [
    ["Cancelled", "cancelled", "payment-reservation-cancelled"],
    ["Confirmed", "settled", "payment-reservation-settled"],
    ["Unknown", "unknown", "payment-reservation-unknown"],
  ] as const) {
    test(`statut ${status} : vue ${view}, jamais l’emplacement de paiement`, async ({
      page,
    }) => {
      await mockBff(page, {
        getBody: reservation({ created: false, status }),
      });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

      const panel = page.getByTestId("payment-reservation-panel");
      await expect(panel).toHaveAttribute("data-status", status);
      await expect(panel).toHaveAttribute("data-view", view);
      await expect(page.getByTestId(marker)).toBeVisible();
      // Le PMS est partagé : payer sur ces statuts serait une promesse fausse (AC-9).
      await expect(page.getByTestId("payment-element-placeholder")).toHaveCount(
        0,
      );
      await expect(page.getByTestId("payment-hold-active")).toHaveCount(0);
    });
  }

  test("réservation annulée en back-office : la reprise ramène à la création", async ({
    page,
  }) => {
    await mockBff(page, {
      getBody: reservation({
        created: false,
        status: "Cancelled",
        holdExpiresAt: null,
      }),
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await page.getByTestId("payment-reservation-cancelled-restart").click();

    await expect(page.getByTestId("payment-create-panel")).toBeVisible();
    await expect(page).not.toHaveURL(/reservationId=/);
  });

  /** Devise inconnue de l'ICU : l'exposant retombe à 2 sans avertir — on refuse d'afficher. */
  test("devise à exposant non fiable : montant remplacé, jamais affiché faux", async ({
    page,
  }) => {
    await mockBff(page, {
      getBody: reservation({ created: false, currency: "XBT" }),
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    const total = page.getByTestId("payment-reservation-total");
    await expect(total).toHaveAttribute("data-amount-unreliable", "true");
    await expect(total).not.toContainText("168");
    await expect(page.getByTestId("payment-total-unreliable")).toBeVisible();
  });

  /** Deux totaux contradictoires juste avant le paiement : jamais (URL retouchée, historique). */
  test("réservation d’un autre séjour : divergence annoncée, deux issues", async ({
    page,
  }) => {
    await mockBff(page, {
      getBody: reservation({ created: false, roomId: OTHER_ROOM_ID }),
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await expect(
      page.getByTestId("payment-reservation-mismatch"),
    ).toBeVisible();
    await expect(page.getByTestId("payment-reservation-panel")).toHaveCount(0);
    await expect(page.getByTestId("payment-mismatch-open")).toBeVisible();
    await expect(page.getByTestId("payment-mismatch-restart")).toBeVisible();
  });

  /**
   * Confondre panne et absence serait grave : inviter à recréer sur une panne laisserait la
   * `Pending` réelle geler une chambre, et en produirait une seconde par-dessus.
   */
  test("relecture en panne (5xx) : « Réessayer », jamais « repartir »", async ({
    page,
  }) => {
    await mockBff(page, { getStatus: 503 });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await expect(page.getByTestId("payment-reservation-retry")).toBeVisible();
    await expect(page.getByTestId("payment-reservation-recap")).toBeVisible();
    await expect(page.getByTestId("payment-reservation-restart")).toHaveCount(
      0,
    );
  });

  test("relecture introuvable (404) : repartir, jamais « Réessayer »", async ({
    page,
  }) => {
    await mockBff(page, { getStatus: 404 });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await expect(page.getByTestId("payment-reservation-restart")).toBeVisible();
    await expect(page.getByTestId("payment-reservation-retry")).toHaveCount(0);

    await page.getByTestId("payment-reservation-restart").click();
    await expect(page.getByTestId("payment-create-panel")).toBeVisible();
    await expect(page).not.toHaveURL(/reservationId=/);
  });

  test("relecture sans session (401) : identification, jamais recréation", async ({
    page,
  }) => {
    await mockBff(page, { getStatus: 401 });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    const identify = page.getByTestId("payment-reservation-identify");
    await expect(identify).toBeVisible();
    await expect(identify).toHaveAttribute(
      "href",
      new RegExp(`reservationId=${RESERVATION_ID}`),
    );
    await expect(page.getByTestId("payment-reservation-restart")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("payment-reservation-retry")).toHaveCount(0);
  });
});

/**
 * États de l'écran et **interactifs qui y vivent**.
 *
 * Cette table sert deux campagnes : l'audit `axe` (contraste des surfaces `destructive` et
 * `warning-soft`, qui n'apparaissent que sur les états d'échec) et la mesure des cibles tactiles.
 * Les deux ne couvraient auparavant que l'écran de création — soit 2 interactifs sur 13, et
 * aucune des paires de couleurs introduites par les panneaux d'échec et de hold expiré.
 */
type StateFamily = "création" | "échec" | "réservation";

const SCREEN_STATES: ReadonlyArray<{
  name: string;
  family: StateFamily;
  open: (page: Page) => Promise<void>;
  interactives: readonly string[];
}> = [
  {
    name: "création",
    family: "création",
    open: async (page) => {
      await mockBff(page);
      await page.goto(paymentUrl());
      await expect(page.getByTestId("payment-create-cta")).toBeVisible();
    },
    interactives: ["payment-back-to-identify", "payment-create-cta"],
  },
  {
    // Story 2.5 : l'écran de création **rempli et en erreur** — le formulaire vide ne voit ni le
    // compteur au-delà de la borne (texte `destructive` sur fond `muted/40`), ni le message
    // d'erreur. Ce sont précisément les paires de couleurs les plus exposées au contraste.
    name: "préférences en erreur",
    family: "création",
    open: async (page) => {
      await mockBff(page);
      await page.goto(paymentUrl());
      await expect(page.getByTestId("payment-create-cta")).toBeVisible();
      await page.getByTestId("special-requests-input").fill("a".repeat(1001));
      await page.getByTestId("payment-create-cta").click();
      await expect(page.getByTestId("special-requests-error")).toBeVisible();
    },
    interactives: ["payment-back-to-identify", "payment-create-cta"],
  },
  {
    name: "réservation créée",
    family: "réservation",
    open: async (page) => {
      await mockBff(page);
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();
    },
    interactives: ["payment-back-to-identify", "payment-back-to-recap"],
  },
  {
    name: "échec de création (chambre prise)",
    family: "échec",
    open: async (page) => {
      await mockBff(page, {
        createStatus: 409,
        createErrors: { reason: ["room-unavailable"] },
      });
      await page.goto(paymentUrl());
      await page.getByTestId("payment-create-cta").click();
      await expect(page.getByTestId("payment-failure")).toBeVisible();
    },
    interactives: [
      "payment-back-to-identify",
      "payment-failure-other-rooms",
      "payment-create-cta",
    ],
  },
  {
    name: "échec de tarif (re-confirmation)",
    family: "échec",
    open: async (page) => {
      await mockBff(page, {
        createStatus: 409,
        createErrors: {
          reason: ["price-changed"],
          total: ["17000"],
          currency: ["EUR"],
        },
      });
      await page.goto(paymentUrl());
      await page.getByTestId("payment-create-cta").click();
      await expect(
        page.getByTestId("payment-failure-confirm-price"),
      ).toBeVisible();
    },
    interactives: [
      "payment-failure-confirm-price",
      "payment-failure-back-to-recap",
    ],
  },
  {
    name: "échec de session (401)",
    family: "échec",
    open: async (page) => {
      await mockBff(page, {
        createStatus: 401,
        createErrors: { reason: ["session-invalid"] },
      });
      await page.goto(paymentUrl());
      await page.getByTestId("payment-create-cta").click();
      await expect(page.getByTestId("payment-failure-identify")).toBeVisible();
    },
    interactives: ["payment-failure-identify"],
  },
  {
    name: "échec de dates (400)",
    family: "échec",
    open: async (page) => {
      await mockBff(page, {
        createStatus: 400,
        createErrors: { reason: ["invalid-dates"] },
      });
      await page.goto(paymentUrl());
      await page.getByTestId("payment-create-cta").click();
      await expect(page.getByTestId("payment-failure-edit-stay")).toBeVisible();
    },
    interactives: ["payment-failure-edit-stay"],
  },
  {
    name: "panne de création (503)",
    family: "échec",
    open: async (page) => {
      await mockBff(page, { createStatus: 503 });
      await page.goto(paymentUrl());
      await page.getByTestId("payment-create-cta").click();
      await expect(page.getByTestId("payment-failure-retry")).toBeVisible();
    },
    interactives: ["payment-failure-retry", "payment-failure-back-to-recap"],
  },
  {
    name: "hold expiré",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, {
        getBody: reservation({ created: false, holdExpiresAt: null }),
      });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(page.getByTestId("payment-hold-expired")).toBeVisible();
    },
    interactives: ["payment-hold-restart", "payment-back-to-recap"],
  },
  {
    name: "réservation annulée",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, {
        getBody: reservation({
          created: false,
          status: "Cancelled",
          holdExpiresAt: null,
        }),
      });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(
        page.getByTestId("payment-reservation-cancelled"),
      ).toBeVisible();
    },
    interactives: ["payment-reservation-cancelled-restart"],
  },
  {
    name: "statut indéterminé",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, {
        getBody: reservation({ created: false, status: "Unknown" }),
      });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(
        page.getByTestId("payment-reservation-unknown"),
      ).toBeVisible();
    },
    interactives: ["payment-reservation-unknown-retry"],
  },
  {
    name: "divergence de séjour",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, {
        getBody: reservation({ created: false, roomId: OTHER_ROOM_ID }),
      });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(
        page.getByTestId("payment-reservation-mismatch"),
      ).toBeVisible();
    },
    interactives: ["payment-mismatch-open", "payment-mismatch-restart"],
  },
  {
    name: "relecture en panne",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, { getStatus: 503 });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(page.getByTestId("payment-reservation-retry")).toBeVisible();
    },
    interactives: ["payment-reservation-retry", "payment-reservation-recap"],
  },
  {
    name: "relecture introuvable",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, { getStatus: 404 });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(
        page.getByTestId("payment-reservation-restart"),
      ).toBeVisible();
    },
    interactives: ["payment-reservation-restart"],
  },
  {
    name: "relecture sans session",
    family: "réservation",
    open: async (page) => {
      await mockBff(page, { getStatus: 401 });
      await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
      await expect(
        page.getByTestId("payment-reservation-identify"),
      ).toBeVisible();
    },
    interactives: ["payment-reservation-identify"],
  },
  {
    name: "devis en panne",
    family: "création",
    open: async (page) => {
      await mockBff(page, { quoteStatus: 503 });
      await page.goto(paymentUrl());
      await expect(page.getByTestId("payment-quote-error")).toBeVisible();
    },
    interactives: ["payment-quote-retry", "payment-quote-exit"],
  },
  {
    name: "séjour bloqué (capacité)",
    family: "création",
    open: async (page) => {
      await mockBff(page, { quoteBody: quote({ guests: 4, roomCapacity: 2 }) });
      await page.goto(paymentUrl({ guests: "4" }));
      await expect(page.getByTestId("payment-blocked")).toBeVisible();
    },
    interactives: ["payment-blocked-exit"],
  },
  {
    name: "session anonyme",
    family: "création",
    open: async (page) => {
      await mockBff(page, { authenticated: false });
      await page.goto(paymentUrl());
      await expect(page.getByTestId("payment-must-identify")).toBeVisible();
    },
    interactives: ["payment-go-to-identify"],
  },
  {
    name: "panne de session",
    family: "création",
    open: async (page) => {
      await mockBff(page, { sessionStatus: 503 });
      await page.goto(paymentUrl());
      await expect(page.getByTestId("payment-session-error")).toBeVisible();
    },
    interactives: ["payment-session-retry"],
  },
];

/** États audités par `axe` dans les DEUX thèmes (cas de test critique n° 12 de la story). */
const AUDITED_STATES = [
  "création",
  "préférences en erreur",
  "réservation créée",
  "échec de création (chambre prise)",
  "échec de tarif (re-confirmation)",
  "hold expiré",
  "réservation annulée",
  "divergence de séjour",
  "devis en panne",
] as const;

test.describe("Tunnel — accessibilité de l’étape de création", () => {
  /**
   * ⚠️ Auditer le seul écran **pré-création** ne voit aucune des paires de couleurs introduites
   * par les panneaux d'échec (`bg-destructive/10 text-destructive`) et de hold expiré
   * (`bg-warning-soft text-warning`) — précisément les surfaces les plus exposées au contraste.
   */
  for (const theme of ["light", "dark"] as const) {
    test(`axe AA sans violation — thème ${theme}, tous les états clés`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });

      for (const name of AUDITED_STATES) {
        const state = SCREEN_STATES.find((s) => s.name === name);
        expect(state, `état « ${name} » déclaré`).toBeDefined();

        await page.unrouteAll();
        await state!.open(page);

        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze();
        expect(results.violations, `${name} (${theme})`).toEqual([]);
      }
    });
  }

  /**
   * `axe` ne voit pas les cibles trop petites (WCAG 2.5.5/2.5.8) : 5 régressions à 32 px avaient
   * échappé en revue 2.2. La boucle précédente ne mesurait que 2 interactifs sur 13, et seulement
   * sur l'écran de création — 9 des non couverts vivent sur les écrans d'échec et de hold expiré.
   */
  for (const family of ["création", "échec", "réservation"] as const) {
    test(`cibles tactiles ≥ 44 px — écrans « ${family} »`, async ({ page }) => {
      // Mobile : c'est là que le critère mord (et que les régressions de 2.2 étaient apparues).
      await page.setViewportSize({ width: 390, height: 844 });

      const states = SCREEN_STATES.filter((s) => s.family === family);
      expect(states.length).toBeGreaterThan(0);

      for (const state of states) {
        await page.unrouteAll();
        await state.open(page);

        // 1. Les interactifs **attendus** sont bien là (sinon l'état n'a pas été atteint et la
        //    mesure ci-dessous porterait sur un écran qui n'est pas celui qu'on croit).
        for (const testId of state.interactives) {
          await expect(
            page.getByTestId(testId),
            `${testId} rendu (état « ${state.name} »)`,
          ).toBeVisible();
        }

        // 2. Et TOUS les interactifs réellement rendus par l'écran sont mesurés — pas seulement
        //    ceux dont on a pensé à écrire le nom. Un `data-testid` ajouté demain est couvert
        //    d'office.
        const targets = page.locator(
          'a[data-testid^="payment-"], button[data-testid^="payment-"]',
        );
        const count = await targets.count();
        expect(
          count,
          `interactifs mesurables (état « ${state.name} »)`,
        ).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
          const target = targets.nth(i);
          const testId = await target.getAttribute("data-testid");
          const box = await target.boundingBox();
          expect(box, `cible ${testId} mesurable`).not.toBeNull();
          expect(
            box!.height,
            `cible ${testId} ≥ 44 px (état « ${state.name} »)`,
          ).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
});

/**
 * Story 2.5 (FR-10) — demandes spéciales & langue de communication, e2e **isolé**.
 *
 * Ce qui est prouvé ici et nulle part ailleurs : le **corps réellement émis par le navigateur**.
 * Les tests d'intégration jsdom lisent un `fetch` bouchonné ; ici on lit la requête HTTP.
 */
test.describe("Tunnel — préférences de communication", () => {
  test("émet la saisie dans le corps de création", async ({ page }) => {
    await mockBff(page);
    const creations = watchCreations(page);
    await page.goto(paymentUrl());

    await page.getByTestId("special-requests-input").fill("Arrivée tardive");
    await page.getByTestId("communication-locale-select").selectOption("en");
    await page.getByTestId("payment-create-cta").click();

    await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();
    expect(creations).toHaveLength(1);
    expect(JSON.parse(creations[0])).toMatchObject({
      specialRequests: "Arrivée tardive",
      communicationLocale: "en",
    });
  });

  test("n’émet aucune clé `specialRequests` quand rien n’est saisi", async ({
    page,
  }) => {
    await mockBff(page);
    const creations = watchCreations(page);
    await page.goto(paymentUrl());

    await page.getByTestId("payment-create-cta").click();
    await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();

    expect(JSON.parse(creations[0])).not.toHaveProperty("specialRequests");
  });

  test("refuse au-delà de la borne sans émettre de création", async ({
    page,
  }) => {
    await mockBff(page);
    const creations = watchCreations(page);
    await page.goto(paymentUrl());

    await page.getByTestId("special-requests-input").fill("a".repeat(1001));
    await page.getByTestId("payment-create-cta").click();

    await expect(page.getByTestId("special-requests-error")).toBeVisible();
    expect(creations).toHaveLength(0);
  });

  test("le compteur suit la saisie sans être annoncé à chaque frappe", async ({
    page,
  }) => {
    await mockBff(page);
    await page.goto(paymentUrl());

    await page.getByTestId("special-requests-input").fill("abc");
    await expect(page.getByTestId("special-requests-counter")).toContainText(
      "3 / 1000",
    );
    // Une région `aria-live` autour du compteur rendrait le champ inutilisable au lecteur d'écran.
    await expect(
      page.getByTestId("special-requests-counter"),
    ).not.toHaveAttribute("aria-live", /.*/);
  });

  test("conserve la saisie à travers un changement de tarif", async ({
    page,
  }) => {
    await mockBff(page, {
      createSequence: [
        {
          status: 409,
          errors: {
            reason: ["price-changed"],
            total: ["17000"],
            currency: ["EUR"],
          },
        },
        { status: 201, body: reservation({ total: 17000 }) },
      ],
    });
    const creations = watchCreations(page);
    await page.goto(paymentUrl());

    await page.getByTestId("special-requests-input").fill("Lit bébé");
    await page.getByTestId("payment-create-cta").click();
    await page.getByTestId("payment-failure-confirm-price").click();

    await expect(page.getByTestId("payment-reservation-panel")).toBeVisible();
    expect(creations).toHaveLength(2);
    // La re-confirmation repart avec la saisie intacte : le voyageur ne re-saisit rien.
    expect(JSON.parse(creations[1])).toMatchObject({
      specialRequests: "Lit bébé",
      expectedTotal: 17000,
    });
  });

  test("affiche les préférences attachées, sans aucun contrôle éditable", async ({
    page,
  }) => {
    await mockBff(page, {
      getBody: reservation({
        created: false,
        specialRequests: "Vue sur mer",
        communicationLocale: "en",
      }),
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    const attached = page.getByTestId("payment-attached-preferences");
    await expect(attached).toContainText("Vue sur mer");
    await expect(page.getByTestId("payment-attached-locale")).toContainText(
      "English",
    );
    // Le PMS n'expose AUCUNE route de mise à jour au voyageur : un champ éditable serait
    // un cul-de-sac garanti.
    await expect(attached.locator("textarea, select, input")).toHaveCount(0);
  });

  test("n’annonce jamais que l’e-mail partira dans la langue choisie", async ({
    page,
  }) => {
    // Honnêteté produit : tant que D10 n'est pas livré, l'hôtel écrit dans SA langue par défaut.
    await mockBff(page);
    await page.goto(paymentUrl());

    const fallback = page.getByTestId("communication-locale-fallback");
    await expect(fallback).toHaveAttribute("data-dependency", "D10");
    // Revue 2ᵉ passe (F2) : la formulation d'origine (« lorsque l'hôtel prend en charge cette
    // langue ») posait une condition **toujours vraie** — le sélecteur n'offre que fr/en, et le PMS
    // supporte exactement fr/en. Le voyageur lisait une promesse ferme déguisée en condition.
    await expect(fallback).toContainText(/ne pilote pas encore/i);
    await expect(page.locator("body")).not.toContainText(/vous recevrez/i);
    await expect(fallback).not.toContainText(
      /lorsque l’hôtel prend en charge cette langue/i,
    );
  });
});

/**
 * Story 3.1 — la fente de paiement, vue du navigateur.
 *
 * Ce qui se prouve ici et pas en test d'intégration : la requête réellement émise vers le BFF
 * (méthode, URL) et le comportement de l'écran quand elle échoue — avant même que Stripe.js
 * n'entre en jeu. Le parcours d'autorisation complet, lui, exige le vrai Stripe.js : il est couvert
 * par le smoke full-stack (`e2e/smoke/booking-payment.smoke.spec.ts`).
 */
test.describe("paiement — demande d'intent (story 3.1)", () => {
  test("une Pending au hold actif demande un intent au BFF, en POST", async ({
    page,
  }) => {
    await mockBff(page);

    const request = page.waitForRequest(
      (req) =>
        req.url().includes(`/payment/reservations/${RESERVATION_ID}/intent`) &&
        req.method() === "POST",
    );

    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    // POST et non GET : l'appel gèle le balayeur de holds et fait émettre un PaymentIntent.
    await expect(await request).toBeTruthy();
  });

  test("aucune demande d'intent quand la vue n'est pas payable", async ({
    page,
  }) => {
    let intentCalls = 0;
    await mockBff(page, {
      getBody: reservation({ created: false, status: "Cancelled" }),
    });
    page.on("request", (req) => {
      if (req.url().includes("/intent")) {
        intentCalls++;
      }
    });

    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));
    await expect(
      page.getByTestId("payment-reservation-cancelled"),
    ).toBeVisible();

    // Demander un intent sur une réservation annulée ferait geler un hold qui n'existe plus.
    expect(intentCalls).toBe(0);
  });

  test("service indisponible : l'écran propose de réessayer", async ({
    page,
  }) => {
    await mockBff(page, { intentStatus: 503, intentBody: { success: false } });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    await expect(page.getByTestId("payment-intent-error")).toBeVisible();
    // « Réessayer » n'a de sens QUE sur une indisponibilité (règle établie en 2.4).
    await expect(page.getByTestId("payment-intent-error-action")).toBeVisible();
  });

  test("paiement déjà engagé : aucune invitation à payer une seconde fois", async ({
    page,
  }) => {
    await mockBff(page, {
      intentStatus: 409,
      intentBody: {
        success: false,
        message: "Le paiement de cette réservation est déjà engagé.",
        errors: { reason: ["already-authorized"] },
      },
    });
    await page.goto(paymentUrl({ reservationId: RESERVATION_ID }));

    // ⚠️ Corrigé en revue de code : « paiement déjà engagé » veut dire que la carte porte une
    // retenue. L'écran doit donc rendre l'ÉTAT « autorisé », pas une alerte — et surtout ne pas
    // reproposer de payer.
    await expect(page.getByTestId("payment-authorized")).toBeVisible();
    await expect(page.getByTestId("payment-intent-error")).toHaveCount(0);
    await expect(page.getByTestId("payment-submit")).toHaveCount(0);
  });
});
