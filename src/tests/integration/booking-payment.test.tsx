import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { BookingPayment } from "@/components/organisms/booking-payment";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import type {
  BookingQuoteResult,
  BookingReservationResult,
} from "@/services/booking.service";
import frMessages from "@/i18n/messages/fr.json";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}));

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ROOM_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";

/** Très loin dans le futur : le minuteur d'expiration ne se déclenche pas pendant le test. */
const HOLD_UNTIL = "2999-07-05T10:15:00.000Z";

/** Échéance telle qu'elle DOIT s'afficher : heure **et fuseau**, comme la politique d'annulation. */
const HOLD_LABEL = new Intl.DateTimeFormat("fr", {
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(HOLD_UNTIL));

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  guests: 2,
  currency: "EUR",
};

const quote: BookingQuoteResult = {
  hotelId: HOTEL_ID,
  hotelName: "Hôtel Colline",
  hotelCity: "Antananarivo",
  hotelLogoUrl: null,
  roomId: ROOM_ID,
  roomNumber: "204",
  roomCategory: "Double Confort",
  roomCapacity: 2,
  roomImageUrl: null,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
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

const SIGNED_IN = {
  authenticated: true,
  user: {
    userId: "u-1",
    email: "voyageur@example.com",
    firstName: "Rakoto",
    lastName: "Randria",
  },
};
const ANONYMOUS = { authenticated: false, user: null };

function reservation(
  overrides: Partial<BookingReservationResult> = {},
): BookingReservationResult {
  return {
    reservationId: RESERVATION_ID,
    reservationCode: "RES-29990705-A1B2C",
    status: "Pending",
    hotelId: HOTEL_ID,
    hotelName: "Hôtel Colline",
    roomId: ROOM_ID,
    roomNumber: "204",
    roomCategory: "Double Confort",
    checkInDate: "2999-07-05",
    checkOutDate: "2999-07-07",
    nights: 2,
    guests: 2,
    currency: "EUR",
    pricePerNight: 8400,
    total: 16_800,
    roomTotal: 16_800,
    servicesTotal: 0,
    services: [],
    holdExpiresAt: HOLD_UNTIL,
    specialRequests: null,
    communicationLocale: null,
    communicationLocaleState: "hotel_default_fallback",
    created: true,
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

/** Corps d'échec tel que le compose `toBookingException` côté BFF. */
function failureBody(reason: string, extra: Record<string, string[]> = {}) {
  return {
    success: false,
    message: "Message technique du BFF",
    errors: { reason: [reason], ...extra },
  };
}

/**
 * Routeur de `fetch` par URL : devis, session et réservations sont pilotés indépendamment.
 *
 * `createReservation` reçoit le **rang** de l'appel : c'est ce qui permet d'enchaîner un refus puis
 * une acceptation, et donc de prouver ce que la seconde soumission oppose réellement au BFF.
 */
function stubFetch(handlers: {
  quote?: () => unknown;
  session?: () => unknown;
  createReservation?: (attempt: number) => unknown;
  getReservation?: (attempt: number) => unknown;
}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let creations = 0;
  let reads = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/booking/quote")) {
      return Promise.resolve(
        handlers.quote?.() ?? json({ success: true, data: quote }),
      );
    }
    if (url.includes("/auth/session")) {
      return Promise.resolve(
        handlers.session?.() ?? json({ success: true, data: SIGNED_IN }),
      );
    }
    if (url.includes("/booking/reservations")) {
      if ((init?.method ?? "GET") === "POST") {
        bodies.push(JSON.parse(init?.body as string));
        return Promise.resolve(
          handlers.createReservation?.(creations++) ??
            json({ success: true, data: reservation() }, 201),
        );
      }
      return Promise.resolve(
        handlers.getReservation?.(reads++) ??
          json({ success: true, data: reservation({ created: false }) }),
      );
    }
    throw new Error(`URL non mockée : ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls, bodies };
}

/**
 * Harnais de rendu.
 *
 * `setReservationId` rejoue le rendu comme le ferait Next après un `router.replace` : la
 * navigation ne change ici que des query-params, elle **ne démonte pas** l'île cliente.
 */
function renderPayment(reservationId: string | null = null) {
  const client = new QueryClient({
    defaultOptions: {
      // Volontairement sans rejeu : ce fichier teste le **comportement d'écran**, pas la politique
      // de retry (prouvée, elle, dans `tests/hooks/use-booking-reservation.test.tsx`).
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  const ui = (id: string | null): ReactElement => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookingPayment params={params} reservationId={id} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const utils = render(ui(reservationId));
  return {
    ...utils,
    client,
    setReservationId: (id: string | null) => utils.rerender(ui(id)),
  };
}

/** Nombre de créations réellement émises vers le BFF. */
function creationCount(calls: string[]): number {
  return calls.filter(
    (c) => c.startsWith("POST") && c.includes("/booking/reservations"),
  ).length;
}

/**
 * Attend que `element` reçoive le focus, en laissant tourner la file d'animation.
 *
 * ⚠️ À utiliser **au lieu de** `waitFor` pour toute assertion de focus. Le composant reprend le
 * focus dans un `requestAnimationFrame` (`focusAfterPaint`), et la boucle interne de `waitFor` ne
 * rend jamais la main à la file d'animation de jsdom : elle attendrait indéfiniment un rappel qui
 * ne peut pas s'exécuter, et ferait passer pour un défaut de focus un artefact du harnais.
 *
 * Un délai fixe ne suffit pas non plus — sous la charge de la suite complète, la frame arrive
 * parfois bien après 50 ms. On sonde donc, avec de vrais minuteurs, jusqu'à une échéance franche.
 */
async function expectFocusOn(element: HTMLElement): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (document.activeElement !== element && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  expect(element).toHaveFocus();
}

/** Dernière URL passée à `router.replace`. */
function lastReplace(): string {
  const call = replace.mock.calls.at(-1);
  return (call?.[0] as string | undefined) ?? "";
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockClear();
});

describe("BookingPayment — création explicite (AC-10)", () => {
  it("ne crée AUCUNE réservation au montage", async () => {
    const { calls } = stubFetch({});
    renderPayment();

    await screen.findByTestId("payment-create-cta");
    // Créer à l'affichage transformerait chaque rafraîchissement en `Pending` supplémentaire.
    expect(creationCount(calls)).toBe(0);
  });

  it("crée la réservation au clic, puis pose `reservationId` dans l'URL", async () => {
    const { calls, bodies } = stubFetch({});
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await waitFor(() => expect(creationCount(calls)).toBe(1));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        expect.stringContaining(`reservationId=${RESERVATION_ID}`),
      ),
    );
    // Le montant opposé au PMS est celui **affiché**, pas un recalcul local (AC-2).
    expect(bodies[0]).toMatchObject({
      expectedTotal: quote.total,
      expectedCurrency: quote.currency,
    });
  });

  it("affiche le code de réservation et l'échéance du hold après création", async () => {
    stubFetch({});
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    expect(
      await screen.findByTestId("payment-reservation-code"),
    ).toHaveTextContent("RES-29990705-A1B2C");
    expect(screen.getByTestId("payment-hold-active")).toBeInTheDocument();
  });

  /**
   * Chaque bascule de panneau démonte l'élément focalisé (ici, le CTA qui vient de disparaître
   * avec l'écran de création) : sans repli explicite, le focus retombe sur `<body>` et un
   * utilisateur au clavier perd sa position juste après l'acte le plus engageant du tunnel.
   */
  it("reprend le focus sur le panneau de réservation après création", async () => {
    stubFetch({});
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    const panel = await screen.findByTestId("payment-reservation-panel");
    expect(panel).toHaveAttribute("tabindex", "-1");
    await expectFocusOn(panel);
  });

  /**
   * `CancellationPolicyDisclosure` rend son échéance en UTC étiquetée : une heure locale **nue**
   * juste à côté donnerait deux référentiels indiscernables sur le même écran (revue 2.2).
   */
  it("affiche l'échéance du hold avec son fuseau, jamais une heure nue", async () => {
    stubFetch({});
    renderPayment(RESERVATION_ID);

    const hold = await screen.findByTestId("payment-hold-active");
    expect(hold).toHaveTextContent(HOLD_LABEL);
    // Le libellé attendu porte bien un fuseau : sans lui, l'assertion ci-dessus ne prouverait rien.
    expect(HOLD_LABEL).not.toMatch(/^\d{1,2}:\d{2}$/);
  });

  it("ne promet ni confirmation ni email (une `Pending` n'est pas confirmée)", async () => {
    stubFetch({});
    renderPayment();
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    const panel = await screen.findByTestId("payment-reservation-panel");
    // Défaut corrigé en Phase 3 de la story 2.3 : ne jamais annoncer au PASSÉ ce qui n'a pas eu
    // lieu. Le futur (« elle sera confirmée une fois le paiement finalisé ») reste légitime.
    expect(panel.textContent).not.toMatch(/est confirmée|envoyé/i);
    expect(panel.textContent).toMatch(/en attente de paiement/i);
  });

  it("tient un hold très lointain pour actif (débordement de `setTimeout`)", async () => {
    // `setTimeout` déborde au-delà de ~24,8 jours et se déclencherait AUSSITÔT : l'écran
    // afficherait « chambre libérée » à l'ouverture.
    stubFetch({});
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-hold-active"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-hold-expired"),
    ).not.toBeInTheDocument();
  });

  it("annonce l'état de la réservation dans une région montée en permanence", async () => {
    stubFetch({});
    renderPayment();

    // La région existe AVANT toute réservation : une région créée à la volée n'annonce rien.
    const live = await screen.findByTestId("payment-status-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await waitFor(() =>
      expect(
        screen.getByTestId("payment-status-announcement"),
      ).toHaveTextContent(/réservée/i),
    );
  });

  /**
   * `disabled` pendant l'appel sortirait le bouton du tab order et ferait retomber le focus sur
   * `<body>` : le blocage transitoire passe donc par `aria-disabled` **plus une garde de clic**.
   * Sans la garde, un `aria-disabled` seul laisserait passer un second POST — donc une seconde
   * `Pending` réelle dans le PMS partagé.
   */
  it("neutralise le CTA pendant l'appel sans le sortir du tab order, et garde le clic", async () => {
    let settle: ((value: unknown) => void) | undefined;
    const inFlight = new Promise((resolve) => {
      settle = resolve;
    });
    const { calls } = stubFetch({ createReservation: () => inFlight });
    renderPayment();

    const cta = await screen.findByTestId("payment-create-cta");
    fireEvent.click(cta);

    await waitFor(() => expect(cta).toHaveAttribute("aria-disabled", "true"));
    expect(cta).not.toBeDisabled();

    // Second clic pendant l'appel : la garde doit l'absorber.
    fireEvent.click(cta);
    expect(creationCount(calls)).toBe(1);

    settle?.(json({ success: true, data: reservation() }, 201));
    await screen.findByTestId("payment-reservation-panel");
    expect(creationCount(calls)).toBe(1);
  });
});

describe("BookingPayment — blocages hérités du devis (AC-10)", () => {
  it("neutralise l'action tant que le devis n'est pas connu", async () => {
    stubFetch({ quote: () => json({ success: false }, 503) });
    renderPayment();

    const cta = await screen.findByTestId("payment-create-cta");
    // Sans devis, on ne connaît ni le prix ni la disponibilité : créer serait irresponsable.
    expect(cta).toBeDisabled();
  });

  it("neutralise l'action et explique un dépassement de capacité", async () => {
    stubFetch({
      quote: () => json({ success: true, data: { ...quote, roomCapacity: 1 } }),
    });
    renderPayment();

    expect(await screen.findByTestId("payment-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("payment-create-cta")).toBeDisabled();
    expect(screen.getByTestId("payment-blocked-exit")).toBeInTheDocument();
  });

  it("neutralise l'action sur une chambre réellement indisponible", async () => {
    stubFetch({
      quote: () =>
        json({ success: true, data: { ...quote, available: false } }),
    });
    renderPayment();

    expect(await screen.findByTestId("payment-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("payment-create-cta")).toBeDisabled();
  });

  it("ne bloque PAS sur une disponibilité dégradée (la création tranchera)", async () => {
    stubFetch({
      quote: () =>
        json({
          success: true,
          data: { ...quote, available: false, availabilityDegraded: true },
        }),
    });
    renderPayment();

    expect(await screen.findByTestId("payment-create-cta")).toBeEnabled();
    expect(screen.queryByTestId("payment-blocked")).not.toBeInTheDocument();
  });

  /** `over-capacity` prime : afficher « plus disponible » à côté masquerait la cause réelle. */
  it("fait primer le dépassement de capacité sur l'indisponibilité", async () => {
    stubFetch({
      quote: () =>
        json({
          success: true,
          data: { ...quote, roomCapacity: 1, available: false },
        }),
    });
    renderPayment();

    const blocked = await screen.findByTestId("payment-blocked");
    expect(blocked.textContent).toMatch(/Trop de voyageurs/i);
    expect(blocked.textContent).not.toMatch(/n’est plus disponible/i);
  });
});

describe("BookingPayment — devis en erreur (issue, jamais de cul-de-sac muet)", () => {
  it("explique la panne du devis et offre « Réessayer » et une sortie", async () => {
    stubFetch({ quote: () => json({ success: false }, 503) });
    renderPayment();

    const panel = await screen.findByTestId("payment-quote-error");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("payment-quote-retry")).toBeInTheDocument();
    expect(screen.getByTestId("payment-quote-exit")).toBeInTheDocument();
    expect(screen.getByTestId("payment-create-cta")).toBeDisabled();
  });

  /** Un 4xx du devis est **définitif** : « Réessayer » y serait un cul-de-sac déguisé. */
  it("n'offre pas de rejeu sur un devis refusé (4xx), seulement une sortie", async () => {
    stubFetch({ quote: () => json({ success: false }, 404) });
    renderPayment();

    const panel = await screen.findByTestId("payment-quote-error");
    expect(panel.textContent).toMatch(/introuvable/i);
    expect(screen.queryByTestId("payment-quote-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-quote-exit")).toBeInTheDocument();
  });

  it("relance réellement le devis au clic sur « Réessayer »", async () => {
    let attempt = 0;
    stubFetch({
      quote: () =>
        attempt++ === 0
          ? json({ success: false }, 503)
          : json({ success: true, data: quote }),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-quote-retry"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("payment-quote-error"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("payment-create-cta")).toBeEnabled();
  });

  it("dit que le total est en cours de calcul plutôt qu'un bouton gris inexpliqué", async () => {
    stubFetch({ quote: () => new Promise(() => {}) });
    renderPayment();

    expect(
      await screen.findByTestId("payment-quote-loading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payment-create-cta")).toBeDisabled();
  });

  /** AC-13 : la raison du blocage doit être **atteignable** depuis le CTA au lecteur d'écran. */
  it("relie le CTA à des explications réellement rendues (`aria-describedby`)", async () => {
    stubFetch({ quote: () => json({ success: false }, 503) });
    renderPayment();

    const cta = await screen.findByTestId("payment-create-cta");
    const ids = (cta.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.filter(Boolean).length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(ids).toContain(screen.getByTestId("payment-quote-error").id);
  });
});

describe("BookingPayment — identification requise", () => {
  it("renvoie à l'identification si la session n'est plus active", async () => {
    stubFetch({ session: () => json({ success: true, data: ANONYMOUS }) });
    renderPayment();

    expect(
      await screen.findByTestId("payment-must-identify"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("payment-create-cta")).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-go-to-identify")).toBeInTheDocument();
  });

  /**
   * L'identification doit pouvoir **revenir** sur la `Pending` déjà créée : sans son identifiant,
   * elle n'est plus adressable et l'écran reproposerait une création.
   */
  it("emporte le `reservationId` connu vers l'identification", async () => {
    stubFetch({ session: () => json({ success: true, data: ANONYMOUS }) });
    renderPayment(RESERVATION_ID);

    const link = await screen.findByTestId("payment-go-to-identify");
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(`reservationId=${RESERVATION_ID}`),
    );
    expect(screen.getByTestId("payment-back-to-identify")).toHaveAttribute(
      "href",
      expect.stringContaining(`reservationId=${RESERVATION_ID}`),
    );
  });

  it("emporte l'identifiant fraîchement créé vers l'identification", async () => {
    stubFetch({});
    renderPayment();
    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    await screen.findByTestId("payment-reservation-panel");

    expect(screen.getByTestId("payment-back-to-identify")).toHaveAttribute(
      "href",
      expect.stringContaining(`reservationId=${RESERVATION_ID}`),
    );
  });

  it("propose de réessayer si la lecture de session échoue (panne ≠ anonyme)", async () => {
    stubFetch({ session: () => json({ success: false }, 503) });
    renderPayment();

    expect(
      await screen.findByTestId("payment-session-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("payment-create-cta")).not.toBeInTheDocument();
  });
});

describe("BookingPayment — échecs et issues (AC-11)", () => {
  async function failWith(body: unknown, status: number) {
    stubFetch({ createReservation: () => json(body, status) });
    renderPayment();
    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    return screen.findByTestId("payment-failure");
  }

  it.each([
    ["room-unavailable", 409, "payment-failure-other-rooms"],
    ["over-capacity", 409, "payment-failure-other-rooms"],
    ["room-not-found", 404, "payment-failure-other-rooms"],
    ["invalid-dates", 400, "payment-failure-edit-stay"],
    // ⚠️ `session-invalid` arrive en **401** (`toBookingException` → `UnauthorizedException`), et
    // `api-client.ts` écrase le corps de tout 401 : le motif est déduit du STATUT. Un 400 ici
    // fabriquerait un scénario que la production ne produit jamais.
    ["session-invalid", 401, "payment-failure-identify"],
    // Refus déterministe non qualifié : le BFF y range tout 4xx PMS non classé (400).
    ["rejected", 400, "payment-failure-back-to-recap"],
  ])("motif `%s` → issue `%s`", async (reason, status, exitTestId) => {
    const panel = await failWith(failureBody(reason), status);

    expect(panel).toHaveAttribute("data-reason", reason);
    expect(screen.getByTestId(exitTestId)).toBeInTheDocument();
    // Règle tranchée en revue 2.2 : jamais de « Réessayer » sur un échec déterministe.
    expect(
      screen.queryByTestId("payment-failure-retry"),
    ).not.toBeInTheDocument();
  });

  /**
   * Le CTA reste juste sous le panneau d'échec : le laisser actif proposerait exactement le
   * cul-de-sac que l'absence de « Réessayer » cherche à éviter.
   */
  it.each([
    ["room-unavailable", 409],
    ["rejected", 400],
    ["rate-limited", 429],
    ["price-changed", 409],
    ["unavailable", 503],
  ])("neutralise le CTA de création sur `%s`", async (reason, status) => {
    await failWith(failureBody(reason), status);
    expect(screen.getByTestId("payment-create-cta")).toBeDisabled();
  });

  it("propose « Réessayer » uniquement sur une panne (503)", async () => {
    const panel = await failWith({ success: false, message: "panne" }, 503);
    expect(panel).toHaveAttribute("data-reason", "unavailable");
    expect(screen.getByTestId("payment-failure-retry")).toBeInTheDocument();
  });

  it("n'offre pas de rejeu immédiat sur une limitation de débit (429), mais une issue", async () => {
    const panel = await failWith({ success: false, message: "trop" }, 429);
    expect(panel).toHaveAttribute("data-reason", "rate-limited");
    expect(
      screen.queryByTestId("payment-failure-retry"),
    ).not.toBeInTheDocument();
    // Sans ces deux issues, la barre d'actions était **entièrement vide** sous le message.
    expect(
      screen.getByTestId("payment-failure-other-rooms"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("payment-failure-back-to-recap"),
    ).toBeInTheDocument();
  });

  /**
   * Le `role="alert"` a été retiré du panneau : inséré **avec** son élément, il n'annonce pas de
   * façon fiable (leçon de la revue 2.2). C'est la région `aria-live` montée en permanence qui
   * porte l'annonce — et le focus qui amène le clavier au message.
   */
  it("annonce l'échec par la région permanente, et y amène le focus", async () => {
    const panel = await failWith(failureBody("room-unavailable"), 409);

    expect(panel).not.toHaveAttribute("role", "alert");
    expect(panel).toHaveAttribute("tabindex", "-1");
    await waitFor(() =>
      expect(
        screen.getByTestId("payment-status-announcement"),
      ).toHaveTextContent(/vient d’être réservée/i),
    );
    await expectFocusOn(panel);
  });

  it("affiche le nouveau total et exige une re-confirmation explicite (`price-changed`)", async () => {
    const panel = await failWith(
      failureBody("price-changed", { total: ["17000"], currency: ["EUR"] }),
      409,
    );

    expect(panel).toHaveAttribute("data-reason", "price-changed");
    // Le montant doit être LU avant d'être accepté : pas de rejeu silencieux (UX-DR-9.2).
    expect(panel.textContent).toContain("170");
    expect(
      screen.getByTestId("payment-failure-confirm-price"),
    ).toBeInTheDocument();
    // Sur un changement de tarif, l'action primaire est la re-confirmation — pas un rejeu.
    expect(
      screen.queryByTestId("payment-failure-retry"),
    ).not.toBeInTheDocument();
    // Le récapitulatif chiffre encore l'ancien total : le dire, plutôt que deux totaux muets.
    expect(screen.getByTestId("payment-summary-outdated")).toBeInTheDocument();
  });

  /**
   * ⚠️ Le cœur du bloquant : re-soumettre l'ANCIEN total ferait recréer par le BFF une `Pending`
   * réelle, la ferait diverger, annuler, et renvoyer un 409 — indéfiniment, avec une ligne
   * `Cancelled` de plus dans le PMS partagé à chaque clic. Le clic est donc joué, pas seulement
   * la présence du bouton.
   */
  it("re-confirme le NOUVEAU total, jamais celui du devis en cache", async () => {
    const { bodies, calls } = stubFetch({
      createReservation: (attempt) =>
        attempt === 0
          ? json(
              failureBody("price-changed", {
                total: ["17000"],
                currency: ["EUR"],
              }),
              409,
            )
          : json({ success: true, data: reservation({ total: 17_000 }) }, 201),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    fireEvent.click(await screen.findByTestId("payment-failure-confirm-price"));

    await waitFor(() => expect(creationCount(calls)).toBe(2));
    expect(bodies[0]).toMatchObject({ expectedTotal: 16_800 });
    expect(bodies[1]).toMatchObject({
      expectedTotal: 17_000,
      expectedCurrency: "EUR",
    });

    // Et l'écran bascule réellement sur la réservation créée au nouveau tarif.
    expect(
      await screen.findByTestId("payment-reservation-panel"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("payment-failure")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-summary-outdated"),
    ).not.toBeInTheDocument();
  });

  /**
   * Un total non entier ferait **lever** `formatCurrency` en plein rendu, et `""` afficherait
   * « désormais 0 € ». `priceChangeFrom` renvoie `null` : l'écran retombe alors sur le message
   * générique, sans bouton de re-confirmation — un cul-de-sac honnête plutôt qu'un montant faux.
   */
  it("n'invente aucun montant quand le nouveau total est illisible", async () => {
    const panel = await failWith(
      failureBody("price-changed", { total: [""], currency: ["EUR"] }),
      409,
    );

    expect(panel).toHaveAttribute("data-reason", "price-changed");
    expect(panel.textContent).not.toMatch(/0\s?€/);
    expect(
      screen.queryByTestId("payment-failure-confirm-price"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("payment-failure-back-to-recap"),
    ).toBeInTheDocument();
  });

  it("n'affiche jamais le texte brut du BFF", async () => {
    const panel = await failWith(
      {
        success: false,
        message: "Room is not available for the selected dates",
        errors: { reason: ["room-unavailable"] },
      },
      409,
    );
    expect(panel.textContent).not.toMatch(/Room is not available/i);
  });

  it("ne navigue pas quand la création échoue", async () => {
    await failWith(failureBody("room-unavailable"), 409);
    expect(replace).not.toHaveBeenCalled();
  });

  it("rejoue réellement la création sur une panne, et efface l'échec au succès", async () => {
    const { calls } = stubFetch({
      createReservation: (attempt) =>
        attempt === 0
          ? json({ success: false, message: "panne" }, 503)
          : json({ success: true, data: reservation() }, 201),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    fireEvent.click(await screen.findByTestId("payment-failure-retry"));

    await waitFor(() => expect(creationCount(calls)).toBe(2));
    expect(
      await screen.findByTestId("payment-reservation-panel"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("payment-failure")).not.toBeInTheDocument();
  });
});

describe("BookingPayment — statut réel de la réservation (AC-9)", () => {
  async function withStatus(overrides: Partial<BookingReservationResult>) {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, ...overrides }),
        }),
    });
    renderPayment(RESERVATION_ID);
    return screen.findByTestId("payment-reservation-panel");
  }

  it.each([
    ["Confirmed", "settled"],
    ["CheckedIn", "settled"],
    ["CheckedOut", "settled"],
    ["Cancelled", "cancelled"],
    ["NoShow", "cancelled"],
    ["Unknown", "unknown"],
  ] as const)(
    "statut `%s` → vue `%s`, jamais payable",
    async (status, view) => {
      const panel = await withStatus({ status });

      expect(panel).toHaveAttribute("data-status", status);
      expect(panel).toHaveAttribute("data-view", view);
      // Le PMS est partagé : proposer de payer sur ces statuts serait une promesse fausse — et,
      // dès la story 3.1, un chemin de double débit.
      expect(
        screen.queryByTestId("payment-element-placeholder"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("payment-hold-active"),
      ).not.toBeInTheDocument();
    },
  );

  it("une `Pending` au hold actif est la SEULE vue payable", async () => {
    const panel = await withStatus({ status: "Pending" });

    expect(panel).toHaveAttribute("data-view", "payable");
    expect(
      screen.getByTestId("payment-element-placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payment-hold-active")).toBeInTheDocument();
  });

  /** `Unknown` n'est jamais assimilé à `Pending`, même avec un hold parfaitement actif. */
  it("ne paie pas sur un statut indéterminé, et propose de relire", async () => {
    await withStatus({ status: "Unknown", holdExpiresAt: HOLD_UNTIL });

    expect(
      screen.getByTestId("payment-reservation-unknown"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("payment-reservation-unknown-retry"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payment-status-announcement")).toHaveTextContent(
      /indéterminé/i,
    );
  });

  it("relit réellement au clic sur la relance d'un statut indéterminé", async () => {
    let reads = 0;
    stubFetch({
      getReservation: () => {
        reads++;
        return json({
          success: true,
          data: reservation({ created: false, status: "Unknown" }),
        });
      },
    });
    renderPayment(RESERVATION_ID);

    fireEvent.click(
      await screen.findByTestId("payment-reservation-unknown-retry"),
    );
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
  });

  it("offre de repartir sur une réservation annulée en back-office", async () => {
    await withStatus({ status: "Cancelled", holdExpiresAt: null });

    expect(
      screen.getByTestId("payment-reservation-cancelled"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("payment-reservation-cancelled-restart"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payment-status-announcement")).toHaveTextContent(
      /annulée/i,
    );
  });

  it("n'invite à rien sur une réservation déjà réglée", async () => {
    await withStatus({ status: "Confirmed", holdExpiresAt: null });

    expect(
      screen.getByTestId("payment-reservation-settled"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-hold-expired"),
    ).not.toBeInTheDocument();
  });

  /**
   * `minorUnitExponent` retombe silencieusement sur 2 décimales pour une devise inconnue de l'ICU :
   * afficher le montant serait risquer un facteur 10ⁿ juste avant le paiement (UX-DR-9.2).
   */
  it("remplace le montant par un libellé quand l'exposant de la devise n'est pas fiable", async () => {
    await withStatus({ currency: "XBT", total: 16_800 });

    const total = screen.getByTestId("payment-reservation-total");
    expect(total).toHaveAttribute("data-amount-unreliable", "true");
    expect(total.textContent).not.toMatch(/168/);
    expect(screen.getByTestId("payment-total-unreliable")).toBeInTheDocument();
  });

  it("affiche le montant normalement sur une devise connue de l'ICU", async () => {
    await withStatus({ currency: "EUR", total: 16_800 });

    const total = screen.getByTestId("payment-reservation-total");
    expect(total).not.toHaveAttribute("data-amount-unreliable");
    expect(total.textContent).toMatch(/168/);
    expect(
      screen.queryByTestId("payment-total-unreliable"),
    ).not.toBeInTheDocument();
  });
});

describe("BookingPayment — réservation d'un autre séjour (divergence)", () => {
  it("refuse d'annoncer « réservée » quand la réservation décrit un autre séjour", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, roomId: OTHER_ROOM_ID }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-reservation-mismatch"),
    ).toBeInTheDocument();
    // Deux totaux contradictoires sous les yeux juste avant le paiement : jamais.
    expect(
      screen.queryByTestId("payment-reservation-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-element-placeholder"),
    ).not.toBeInTheDocument();
    // Deux issues : ouvrir la réservation telle qu'elle est, ou repartir sur le séjour affiché.
    expect(screen.getByTestId("payment-mismatch-open")).toHaveAttribute(
      "href",
      expect.stringContaining(`reservationId=${RESERVATION_ID}`),
    );
    expect(screen.getByTestId("payment-mismatch-restart")).toBeInTheDocument();
    expect(screen.getByTestId("payment-status-announcement")).toHaveTextContent(
      /autre séjour/i,
    );
  });

  it.each([
    ["dates", { checkInDate: "2999-08-01", checkOutDate: "2999-08-03" }],
    ["voyageurs", { guests: 4 }],
  ])(
    "détecte aussi une divergence de %s",
    async (_label, overrides: Partial<BookingReservationResult>) => {
      stubFetch({
        getReservation: () =>
          json({
            success: true,
            data: reservation({ created: false, ...overrides }),
          }),
      });
      renderPayment(RESERVATION_ID);

      expect(
        await screen.findByTestId("payment-reservation-mismatch"),
      ).toBeInTheDocument();
    },
  );

  /** Le PMS peut sérialiser ses dates en instant ISO : le jour calendaire reste le même séjour. */
  it("ne crie pas à la divergence sur une date sérialisée en instant ISO", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({
            created: false,
            checkInDate: "2999-07-05T00:00:00Z",
            checkOutDate: "2999-07-07T00:00:00Z",
          }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-reservation-panel"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-reservation-mismatch"),
    ).not.toBeInTheDocument();
  });
});

describe("BookingPayment — reprise sans perte (AC-9)", () => {
  it("relit la réservation portée par l'URL sans en créer une seconde", async () => {
    const { calls } = stubFetch({});
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-reservation-panel"),
    ).toBeInTheDocument();
    expect(creationCount(calls)).toBe(0);
    expect(
      calls.some(
        (c) =>
          c.startsWith("GET ") &&
          c.endsWith(`/booking/reservations/${RESERVATION_ID}`),
      ),
    ).toBe(true);
  });

  it("offre de repartir quand la réservation de l'URL est introuvable", async () => {
    stubFetch({ getReservation: () => json({ success: false }, 404) });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-reservation-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("payment-reservation-restart"),
    ).toBeInTheDocument();
    // Une absence n'est pas une panne : « Réessayer » n'a rien à faire ici.
    expect(
      screen.queryByTestId("payment-reservation-retry"),
    ).not.toBeInTheDocument();
  });

  /**
   * ⚠️ Confondre panne et absence serait grave : affirmer que la réservation n'existe pas et
   * inviter à en créer une autre laisserait la `Pending` réelle geler une vraie chambre, puis en
   * produirait une seconde par-dessus. « Réessayer » n'est offert que sur la panne.
   */
  it("distingue la panne (réessayer) de l'absence (repartir)", async () => {
    stubFetch({ getReservation: () => json({ success: false }, 503) });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-reservation-retry"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payment-reservation-recap")).toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-reservation-restart"),
    ).not.toBeInTheDocument();
  });

  it("renvoie à l'identification quand la relecture bute sur une session expirée (401)", async () => {
    stubFetch({ getReservation: () => json({ success: false }, 401) });
    renderPayment(RESERVATION_ID);

    const identify = await screen.findByTestId("payment-reservation-identify");
    expect(identify).toHaveAttribute(
      "href",
      expect.stringContaining(`reservationId=${RESERVATION_ID}`),
    );
    // Une session expirée n'est ni une absence ni une panne.
    expect(
      screen.queryByTestId("payment-reservation-restart"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-reservation-retry"),
    ).not.toBeInTheDocument();
  });

  it("relit réellement au clic sur « Réessayer » d'une panne de relecture", async () => {
    let reads = 0;
    stubFetch({
      getReservation: () => {
        reads++;
        return reads === 1
          ? json({ success: false }, 503)
          : json({
              success: true,
              data: reservation({ created: false }),
            });
      },
    });
    renderPayment(RESERVATION_ID);

    fireEvent.click(await screen.findByTestId("payment-reservation-retry"));

    expect(
      await screen.findByTestId("payment-reservation-panel"),
    ).toBeInTheDocument();
  });

  /**
   * `payment-reservation-restart` est passé de `<Link>` à `<Button>` : un lien vers la même page
   * ne démonterait pas l'île cliente, et `create.data` resterait non nul. On assert donc sur
   * `router.replace` **et** sur la reprise effective une fois l'URL rejouée.
   */
  it("repart d'un écran de création vierge depuis une réservation introuvable", async () => {
    stubFetch({ getReservation: () => json({ success: false }, 404) });
    const { setReservationId } = renderPayment(RESERVATION_ID);

    const restart = await screen.findByTestId("payment-reservation-restart");
    // ⚠️ C'est un `<Button>`, pas un `<Link>` : un lien vers la même page ne démonterait pas l'île
    // cliente et laisserait `create.data` en place. Le passage au bouton EST le correctif.
    expect(restart.tagName).toBe("BUTTON");
    fireEvent.click(restart);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastReplace()).not.toContain("reservationId");
    expect(lastReplace()).toContain(`hotelId=${HOTEL_ID}`);

    setReservationId(null);
    expect(
      await screen.findByTestId("payment-create-panel"),
    ).toBeInTheDocument();
  });
});

describe("BookingPayment — expiration du hold (AC-12)", () => {
  it("annonce la libération et retire l'accès au paiement", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, holdExpiresAt: null }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-hold-expired"),
    ).toBeInTheDocument();
    // Le paiement ne doit plus être proposé sur une chambre remise à la vente.
    expect(
      screen.queryByTestId("payment-element-placeholder"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-hold-restart")).toBeInTheDocument();
    expect(screen.getByTestId("payment-status-announcement")).toHaveTextContent(
      /n’est plus tenue/i,
    );
  });

  /**
   * ⚠️ Le bloquant : `router.replace` ne change ici que des query-params, il ne démonte pas l'île.
   * Sans `create.reset()`, `create.data` restait non nul et le MÊME panneau « chambre libérée » se
   * réaffichait indéfiniment. Le bouton est donc **cliqué**, et le retour à l'état de création
   * prouvé sans aucun changement de prop.
   */
  it("repart réellement à l'état de création au clic sur la reprise", async () => {
    stubFetch({
      createReservation: () =>
        json(
          { success: true, data: reservation({ holdExpiresAt: null }) },
          201,
        ),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    fireEvent.click(await screen.findByTestId("payment-hold-restart"));

    expect(
      await screen.findByTestId("payment-create-panel"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("payment-reservation-panel"),
    ).not.toBeInTheDocument();
    // L'URL repart sans `reservationId` : une reprise ne doit pas relire la réservation périmée.
    expect(lastReplace()).not.toContain("reservationId");
    // Et le CTA est de nouveau actionnable — pas un écran mort.
    expect(screen.getByTestId("payment-create-cta")).toBeEnabled();
    // ⚠️ La reprise du focus n'est PAS assertée ici : `restart()` planifie son
    // `requestAnimationFrame` avant que React Query n'ait notifié la remise à zéro (notification
    // différée d'un `setTimeout(0)`), et sous jsdom l'ordre des deux minuteurs n'est pas garanti —
    // le test échouait une fois sur deux sans qu'aucun code n'ait changé. Dans un vrai navigateur
    // la frame suit toujours le macrotask : la reprise du focus est donc prouvée en e2e
    // (`src/tests/e2e/booking-payment.spec.ts`), où elle est déterministe.
  });

  it("repart aussi depuis une réservation annulée en back-office", async () => {
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({ status: "Cancelled", holdExpiresAt: null }),
          },
          201,
        ),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    fireEvent.click(
      await screen.findByTestId("payment-reservation-cancelled-restart"),
    );

    expect(
      await screen.findByTestId("payment-create-panel"),
    ).toBeInTheDocument();
    expect(lastReplace()).not.toContain("reservationId");
  });

  it("bascule à l'échéance atteinte pendant que la page est ouverte", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetch({
        getReservation: () =>
          json({
            success: true,
            data: reservation({
              created: false,
              holdExpiresAt: new Date(Date.now() + 1_000).toISOString(),
            }),
          }),
      });
      renderPayment(RESERVATION_ID);

      expect(
        await screen.findByTestId("payment-hold-active"),
      ).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1_500);

      await waitFor(() =>
        expect(screen.getByTestId("payment-hold-expired")).toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  /** Une échéance illisible ne doit JAMAIS valoir « chambre tenue » par défaut. */
  it("traite une échéance illisible comme un hold échu", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, holdExpiresAt: "pas-une-date" }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-hold-expired"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("payment-hold-active")).not.toBeInTheDocument();
  });
});

/**
 * Story 2.5 (FR-10) — demandes spéciales & langue de communication.
 *
 * Ces champs partent dans le MÊME appel que la création : le PMS n'expose aucune route de mise à
 * jour au voyageur. Ce que ces tests protègent, c'est donc l'unique fenêtre où la saisie compte.
 */
describe("BookingPayment — préférences (story 2.5)", () => {
  it("propose les deux champs facultatifs sans conditionner le CTA", async () => {
    stubFetch({});
    renderPayment();

    expect(
      await screen.findByTestId("booking-preferences"),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("payment-create-cta")).toBeEnabled();
  });

  it("joint la saisie au corps de création", async () => {
    const { bodies } = stubFetch({});
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Arrivée tardive" },
    });
    fireEvent.change(screen.getByTestId("communication-locale-select"), {
      target: { value: "en" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      specialRequests: "Arrivée tardive",
      communicationLocale: "en",
    });
    // `localeTouched` est un état d'INTERFACE : il ne franchit jamais le fil (il n'est pas déclaré
    // au DTO du BFF, `forbidNonWhitelisted` le refuserait en 400).
    expect(bodies[0]).not.toHaveProperty("localeTouched");
  });

  it("crée sans demande spéciale quand rien n'est saisi (aucune clé vide)", async () => {
    const { bodies } = stubFetch({});
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty("specialRequests");
    // Et la langue non plus : un sélecteur jamais touché n'exprime PAS une préférence (revue
    // 2ᵉ passe, F6). L'envoyer quand même rendait l'état « aucun choix » inatteignable, alors que
    // le DTO du BFF promet de distinguer « pas de choix » de « choix = fr ».
    expect(bodies[0]).not.toHaveProperty("communicationLocale");
  });

  it("refuse localement au-delà de la borne, SANS appeler le BFF", async () => {
    // Un aller-retour réseau pour une erreur connaissable localement laisserait le voyageur
    // devant un échec générique au lieu d'un message attaché à son champ (UX-DR-5.9).
    const { calls } = stubFetch({});
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "a".repeat(1001) },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    expect(
      await screen.findByTestId("special-requests-error"),
    ).toBeInTheDocument();
    expect(creationCount(calls)).toBe(0);
  });

  /**
   * ⚠️ Le cœur de l'AC-7 : la saisie survit à un échec. Sans état levé, le formulaire serait
   * remonté vide et le voyageur re-confirmerait un nouveau tarif en ayant perdu ses demandes —
   * silencieusement, puisque la création ne les réclame pas.
   */
  it("conserve la saisie à travers un `price-changed` et la renvoie à la re-confirmation", async () => {
    const { bodies } = stubFetch({
      createReservation: (attempt) =>
        attempt === 0
          ? json(
              failureBody("price-changed", {
                total: ["17000"],
                currency: ["EUR"],
              }),
              409,
            )
          : json({ success: true, data: reservation({ total: 17_000 }) }, 201),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Lit bébé" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    fireEvent.click(await screen.findByTestId("payment-failure-confirm-price"));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toMatchObject({ specialRequests: "Lit bébé" });
    expect(bodies[1]).toMatchObject({
      specialRequests: "Lit bébé",
      expectedTotal: 17_000,
    });
  });

  it("affiche les préférences attachées en LECTURE SEULE après création", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({
            created: false,
            specialRequests: "Vue sur mer",
            communicationLocale: "en",
          }),
        }),
    });
    renderPayment(RESERVATION_ID);

    const attached = await screen.findByTestId("payment-attached-preferences");
    expect(attached).toHaveTextContent("Vue sur mer");
    expect(screen.getByTestId("payment-attached-locale")).toHaveTextContent(
      "English",
    );
    // Aucun contrôle éditable : le PMS n'offre AUCUNE route de mise à jour au voyageur.
    expect(attached.querySelector("textarea")).toBeNull();
    expect(attached.querySelector("select")).toBeNull();
    expect(attached.querySelector("input")).toBeNull();
  });

  it("dit que ces informations ne sont plus modifiables ici", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, specialRequests: "Vue sur mer" }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-attached-preferences"),
    ).toHaveTextContent(/contactez l’hôtel/i);
  });

  it("n'affiche aucun bloc de préférences quand la réservation n'en porte pas", async () => {
    // Un « Aucune demande spéciale » permanent serait du bruit sur toutes les réservations.
    stubFetch({
      getReservation: () =>
        json({ success: true, data: reservation({ created: false }) }),
    });
    renderPayment(RESERVATION_ID);

    await screen.findByTestId("payment-reservation-panel");
    expect(
      screen.queryByTestId("payment-attached-preferences"),
    ).not.toBeInTheDocument();
  });

  /**
   * AC-6 — sur un rejeu idempotent, la réservation garde le texte de la PREMIÈRE soumission.
   * L'écran doit dire laquelle fait foi, sinon le voyageur croit sa correction enregistrée.
   */
  it("signale la divergence entre la saisie courante et ce qui est attaché", async () => {
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({
              created: false,
              specialRequests: "Texte d’origine",
            }),
          },
          200,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Texte corrigé" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    expect(
      await screen.findByTestId("payment-preferences-diverged"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("payment-attached-special-requests"),
    ).toHaveTextContent("Texte d’origine");
  });

  it("ne signale AUCUNE divergence quand la saisie correspond", async () => {
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({ specialRequests: "Vue sur mer" }),
          },
          201,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Vue sur mer" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await screen.findByTestId("payment-attached-preferences");
    expect(
      screen.queryByTestId("payment-preferences-diverged"),
    ).not.toBeInTheDocument();
  });

  it("neutralise les champs pendant la soumission", async () => {
    let resolve!: (value: unknown) => void;
    stubFetch({
      createReservation: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    renderPayment();

    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await waitFor(() =>
      expect(screen.getByTestId("special-requests-input")).toBeDisabled(),
    );
    resolve(json({ success: true, data: reservation() }, 201));
  });
});

/**
 * Revue 2.5 — la notice de divergence ne doit **jamais** apparaître sur une création fraîche.
 *
 * Défaut trouvé en revue : le front comparait sa saisie brute (`trim()` seul) à la valeur
 * **normalisée par le BFF** (tabulations, zero-width et bidi remplacés par une espace). Une saisie
 * collée depuis un tableur ou une page web déclenchait donc, sur une première création réussie, le
 * message « votre réservation existait déjà » — une affirmation fausse, au pire endroit du tunnel.
 */
describe("BookingPayment — divergence des préférences (revue 2.5)", () => {
  it("ne crie PAS à la divergence quand le BFF a seulement normalisé la saisie", async () => {
    // Le voyageur colle un texte contenant une tabulation ; le PMS stocke la version normalisée.
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({
              created: true,
              specialRequests: "Chambre calme",
            }),
          },
          201,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Chambre\tcalme" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await screen.findByTestId("payment-attached-preferences");
    expect(
      screen.queryByTestId("payment-preferences-diverged"),
    ).not.toBeInTheDocument();
  });

  it("ne crie pas à la divergence sur une création fraîche, quel que soit l'écart", async () => {
    // Garde de principe : `created: true` signifie « rien ne préexistait ». Toute différence y est
    // du bruit de normalisation, jamais un rejeu.
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({
              created: true,
              specialRequests: "Texte totalement different",
            }),
          },
          201,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Ce que j'ai tape" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await screen.findByTestId("payment-attached-preferences");
    expect(
      screen.queryByTestId("payment-preferences-diverged"),
    ).not.toBeInTheDocument();
  });

  it("ne réintroduit pas la notice quand la relecture remplace la réponse de création", async () => {
    // Piège : `GET /booking/reservations/:id` renvoie TOUJOURS `created: false`. Se fier au statut
    // de l'objet affiché ferait réapparaître la notice quelques centaines de ms après une création
    // normale, dès l'arrivée de la relecture.
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({ created: true, specialRequests: "Vue mer" }),
          },
          201,
        ),
      getReservation: () =>
        json({
          success: true,
          data: reservation({ created: false, specialRequests: "Vue mer" }),
        }),
    });
    const { setReservationId } = renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Vue\tmer" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    await screen.findByTestId("payment-attached-preferences");

    // Le `router.replace` de l'écran ajoute l'identifiant : la relecture s'active.
    setReservationId(RESERVATION_ID);

    await waitFor(() =>
      expect(
        screen.getByTestId("payment-attached-special-requests"),
      ).toHaveTextContent("Vue mer"),
    );
    expect(
      screen.queryByTestId("payment-preferences-diverged"),
    ).not.toBeInTheDocument();
  });
});

/**
 * Corrections de la 2ᵉ passe de revue (F1, F3, F4, F8, F13).
 *
 * Trois d'entre elles portent sur des **régressions introduites par la 1ʳᵉ passe** : la revue
 * indépendante a trouvé ce que la relecture par l'auteur ne pouvait pas voir.
 */
describe("BookingPayment — corrections de la 2ᵉ passe", () => {
  /**
   * F1 — la réserve D10 doit **suivre** le choix jusque dans le panneau de lecture seule.
   *
   * Elle n'existait que dans le formulaire : l'avertissement honnête vivait tant que le choix
   * était réversible et disparaissait à l'instant où il devenait définitif. C'est pourtant le seul
   * écran que le voyageur relit après avoir réservé.
   */
  it("porte la réserve D10 jusque dans le panneau de réservation", async () => {
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({
            created: false,
            communicationLocale: "en",
            communicationLocaleState: "hotel_default_fallback",
          }),
        }),
    });
    renderPayment(RESERVATION_ID);

    expect(
      await screen.findByTestId("payment-attached-locale-fallback"),
    ).toBeInTheDocument();
  });

  it("retire la réserve le jour où le BFF annonce `applied` (bascule D10)", async () => {
    // L'état vient du BFF, jamais d'une déduction locale : le front n'a rien à recoder ce jour-là.
    stubFetch({
      getReservation: () =>
        json({
          success: true,
          data: reservation({
            created: false,
            communicationLocale: "en",
            communicationLocaleState: "applied",
          }),
        }),
    });
    renderPayment(RESERVATION_ID);

    await screen.findByTestId("payment-attached-locale");
    expect(
      screen.queryByTestId("payment-attached-locale-fallback"),
    ).not.toBeInTheDocument();
  });

  /**
   * F3 — le clic sur le CTA en dépassement ne produisait plus AUCUN retour perceptible : le
   * message était déjà affiché (correctif de la 1ʳᵉ passe), donc le clic ne changeait aucun nœud.
   */
  it("déplace le focus sur le champ fautif quand le clic est refusé", async () => {
    stubFetch({});
    renderPayment();

    const champ = await screen.findByTestId("special-requests-input");
    fireEvent.change(champ, { target: { value: "a".repeat(1001) } });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await expectFocusOn(champ);
  });

  /**
   * F4 — l'erreur de soumission ne survit pas à une saisie qui la rend caduque. Elle primait sans
   * condition : après un refus à 1001 caractères, effacer jusqu'à 10 laissait « ne peuvent pas
   * dépasser 1000 caractères » à côté d'un compteur affichant « 10 / 1000 ».
   */
  it("efface la cause dès que la saisie redevient valide", async () => {
    stubFetch({});
    renderPayment();

    const champ = await screen.findByTestId("special-requests-input");
    fireEvent.change(champ, { target: { value: "a".repeat(1001) } });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));
    expect(await screen.findByTestId("special-requests-error")).toBeVisible();

    fireEvent.change(champ, { target: { value: "court" } });

    await waitFor(() =>
      expect(
        screen.queryByTestId("special-requests-error"),
      ).not.toBeInTheDocument(),
    );
    expect(champ).not.toHaveAttribute("aria-invalid");
  });

  /**
   * F8 — la notice de divergence était **inatteignable** dans le cas le plus grave : rejeu d'une
   * réservation qui ne porte NI demandes NI langue, pendant que le voyageur vient d'en taper. Le
   * `return null` du panneau la court-circuitait, et il repartait en croyant son texte enregistré.
   */
  it("signale la divergence même quand la réservation ne porte aucune préférence", async () => {
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({
              created: false,
              specialRequests: null,
              communicationLocale: null,
            }),
          },
          200,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Texte que je crois enregistré" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    expect(
      await screen.findByTestId("payment-preferences-diverged"),
    ).toBeInTheDocument();
  });

  /** F5 — deux textes équivalents à la normalisation près ne divergent pas. */
  it("ne crie pas à la divergence sur un écart de pure normalisation", async () => {
    stubFetch({
      createReservation: () =>
        json(
          {
            success: true,
            data: reservation({ created: false, specialRequests: "Vue mer" }),
          },
          200,
        ),
    });
    renderPayment();

    fireEvent.change(await screen.findByTestId("special-requests-input"), {
      target: { value: "Vue\tmer" },
    });
    fireEvent.click(await screen.findByTestId("payment-create-cta"));

    await screen.findByTestId("payment-attached-preferences");
    expect(
      screen.queryByTestId("payment-preferences-diverged"),
    ).not.toBeInTheDocument();
  });
});
