import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { BookingRecap } from "@/components/organisms/booking-recap";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import type { BookingQuoteResult } from "@/services/booking.service";
import frMessages from "@/i18n/messages/fr.json";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

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

function okResponse(body: BookingQuoteResult) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: body }),
  };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, message: "nope" }),
  };
}

function renderRecap(overrides: Partial<ParsedBookingParams> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookingRecap params={{ ...params, ...overrides }} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BookingRecap (intégration)", () => {
  afterEach(() => {
    cleanup();
    replace.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("affiche des squelettes pendant le chargement du devis", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderRecap();
    expect(screen.getByTestId("booking-loading")).toBeInTheDocument();
  });

  it("rend le récapitulatif et un CTA actif vers l’étape d’identification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(quote)));
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-summary")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("booking-total").textContent).toContain("168");

    const cta = screen.getByTestId("booking-continue");
    expect(cta.tagName).toBe("A");
    const href = cta.getAttribute("href") ?? "";
    expect(href).toContain("/booking/identify?");
    expect(href).toContain(`hotelId=${HOTEL_ID}`);
    expect(href).toContain(`roomId=${ROOM_ID}`);
    expect(href).toContain("checkInDate=2999-07-05");
    expect(href).toContain("guests=2");
  });

  /**
   * AC-2 : modifier le séjour réécrit l'URL (contexte complet), ce qui change la clé React Query
   * et re-demande un devis AVANT toute création. `replace` et non `push` : le retour arrière doit
   * ramener à la fiche chambre, pas dérouler chaque essai de dates.
   */
  it("recalcule via l’URL quand le nombre de voyageurs change", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(quote));
    vi.stubGlobal("fetch", fetchMock);
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-summary")).toBeInTheDocument(),
    );

    // Le nombre de voyageurs est RÉELLEMENT modifié (2 → 3) avant soumission : resoumettre le
    // formulaire inchangé prouverait seulement qu'il soumet, pas qu'une modification se propage.
    fireEvent.click(screen.getByTestId("guest-selector-trigger"));
    // ⚠️ Patience explicite, et non un défaut implicite de 5 s : `GuestSelector` ouvre un popover
    // monté dans un portail, dont l'apparition dépend de la file d'animation de jsdom. Sous la
    // charge de la suite complète (50 fichiers en parallèle), 5 s ne suffisaient pas — ce test
    // tombait environ une exécution sur deux depuis la story 2.2, en isolation toujours vert.
    // Ce n'est pas un défaut du composant : c'est le harnais qui doit attendre le montage réel.
    // Même discipline que `expectFocusOn` dans `booking-payment.test.tsx`.
    fireEvent.click(
      await screen.findByTestId("guest-increase", {}, { timeout: 20_000 }),
    );
    expect(screen.getByTestId("guest-count").textContent).toBe("3");

    fireEvent.submit(screen.getByTestId("booking-stay-editor"));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), {
      timeout: 20_000,
    });
    const [url, options] = replace.mock.calls[0] as [
      string,
      { scroll?: boolean },
    ];
    expect(url).toContain("/booking/recap?");
    expect(url).toContain("checkInDate=2999-07-05");
    // La NOUVELLE valeur est portée par l'URL — c'est elle qui déclenchera le refetch.
    expect(url).toContain("guests=3");
    expect(url).not.toContain("guests=2");
    expect(options.scroll).toBe(false);
  });

  it("re-demande un devis quand le contexte de séjour change (nouveau total annoncé)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(quote))
      .mockResolvedValueOnce(
        okResponse({
          ...quote,
          checkOutDate: "2999-07-08",
          nights: 3,
          roomTotal: 25_200,
          total: 25_200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // ⚠️ Le MÊME `QueryClient` est conservé au rerender : en injecter un neuf viderait le cache et
    // garantirait le refetch quelle que soit la clé — le test passerait même si `bookingKeys.quote`
    // ignorait `checkOutDate`. C'est bien le changement de clé que l'on veut prouver ici.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderWith = (overrides: Partial<ParsedBookingParams>) => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <BookingRecap params={{ ...params, ...overrides }} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(renderWith({}));
    await waitFor(() =>
      expect(screen.getByTestId("booking-total").textContent).toContain("168"),
    );

    rerender(renderWith({ checkOutDate: "2999-07-08" }));

    await waitFor(() =>
      expect(screen.getByTestId("booking-total").textContent).toContain("252"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Revue 2.2 : pendant un recalcul, `keepPreviousData` affiche encore le devis PRÉCÉDENT alors que
   * l'URL porte déjà le nouveau contexte. Laisser le CTA actif ferait entrer à l'étape 2 avec un
   * séjour jamais tarifé ni vérifié en disponibilité.
   */
  it("neutralise le CTA tant que le devis affiché ne correspond pas au séjour demandé", async () => {
    let resolveSecond: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(quote))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderWith = (overrides: Partial<ParsedBookingParams>) => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <BookingRecap params={{ ...params, ...overrides }} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(renderWith({}));
    await waitFor(() =>
      expect(screen.getByTestId("booking-continue")).toBeInTheDocument(),
    );

    rerender(renderWith({ checkOutDate: "2999-07-08" }));

    // Recalcul en vol : plus de lien actif, et le blocage est motivé par le recalcul — pas par une
    // indisponibilité que l'on ne connaît pas encore.
    await waitFor(() =>
      expect(screen.getByTestId("booking-continue-disabled")).toBeDisabled(),
    );
    expect(screen.queryByTestId("booking-continue")).toBeNull();
    expect(
      screen
        .getByTestId("booking-continue-disabled")
        .getAttribute("data-blocked-reason"),
    ).toBe("recalculating");
    // Le détail périmé est marqué comme tel, jamais présenté comme courant.
    expect(
      screen.getByTestId("booking-summary-panel").getAttribute("aria-busy"),
    ).toBe("true");
    // Et surtout : aucune affirmation d'indisponibilité pendant le recalcul.
    expect(screen.queryByTestId("booking-unavailable")).toBeNull();

    resolveSecond?.(
      okResponse({
        ...quote,
        checkOutDate: "2999-07-08",
        nights: 3,
        roomTotal: 25_200,
        total: 25_200,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("booking-continue")).toBeInTheDocument(),
    );
  });

  /**
   * Revue 2.2 : un 4xx non-404 est une saisie refusée (séjour hors bornes), pas une panne. Le
   * rejouer à l'identique échouerait indéfiniment — et l'écran doit rester corrigeable sur place.
   */
  it("400 : séjour refusé → message dédié, sans Réessayer, avec l’éditeur de séjour", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(400)));
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-stay-rejected")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("booking-retry")).toBeNull();
    expect(screen.getByTestId("booking-error-exit")).toBeInTheDocument();
    // Corrigeable sur place : l'éditeur reste monté (jamais de cul-de-sac).
    expect(screen.getByTestId("booking-stay-editor")).toBeInTheDocument();
  });

  it("bloque le passage à l’étape suivante quand la chambre n’est plus disponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...quote,
          available: false,
          availabilityDegraded: false,
        }),
      ),
    );
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-unavailable")).toBeInTheDocument(),
    );
    // Pas de lien mort : le CTA est un bouton désactivé, et une sortie est offerte.
    expect(screen.getByTestId("booking-continue-disabled")).toBeDisabled();
    expect(screen.queryByTestId("booking-continue")).toBeNull();
    expect(
      screen.getByTestId("booking-unavailable-exit").getAttribute("href"),
    ).toContain("/hotels/");
  });

  /**
   * Décision de revue 2.2 : un dépassement de capacité est un fait **déterministe** porté par le
   * devis lui-même, pas une incertitude PMS. La règle « la dégradation ne bloque jamais » (AC-7)
   * lui laissait le CTA actif — vers une création qui échouerait en 2.4, après l'identification.
   */
  it("bloque sur un dépassement de capacité, même quand la disponibilité est dégradée", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...quote,
          guests: 4,
          roomCapacity: 2,
          available: false,
          availabilityDegraded: true,
        }),
      ),
    );
    renderRecap({ guests: 4 });

    await waitFor(() =>
      expect(screen.getByTestId("booking-over-capacity")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("booking-continue-disabled")).toBeDisabled();
    expect(screen.queryByTestId("booking-continue")).toBeNull();
    expect(
      screen
        .getByTestId("booking-continue-disabled")
        .getAttribute("data-blocked-reason"),
    ).toBe("over-capacity");
    // Le message nomme la contrainte réelle, sans affirmer une indisponibilité inconnue.
    expect(screen.getByTestId("booking-over-capacity").textContent).toMatch(
      /2 personnes/,
    );
    expect(screen.queryByTestId("booking-unavailable")).toBeNull();
    // Le bloc remplace l'avis générique : il doit en reprendre la porte de sortie.
    expect(
      screen.getByTestId("booking-over-capacity-exit").getAttribute("href"),
    ).toContain("/hotels/");
  });

  /**
   * Trouvé en **Phase 3** (revue 2.2) : le PMS sort la chambre de son set daté quand la capacité
   * est dépassée, donc `available: false` ET capacité dépassée arrivent ensemble. L'écran
   * affichait alors DEUX alertes : la cause vague (« n'est plus disponible… ou votre nombre de
   * voyageurs ») à côté de la cause réelle. Une seule explication doit subsister — la bonne.
   */
  it("n’affiche qu’une seule cause quand la capacité est dépassée et la chambre sortie du set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...quote,
          guests: 3,
          roomCapacity: 2,
          available: false,
          availabilityDegraded: false,
        }),
      ),
    );
    renderRecap({ guests: 3 });

    await waitFor(() =>
      expect(screen.getByTestId("booking-over-capacity")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("booking-unavailable")).toBeNull();
    // Y compris dans le récapitulatif, qui portait son propre avis « plus disponible ».
    expect(screen.queryByTestId("booking-unavailable-notice")).toBeNull();
    expect(screen.getByTestId("booking-continue-disabled")).toBeDisabled();
  });

  /** Une panne du cross-check ne doit PAS bloquer le tunnel (règle 1.10). */
  it("laisse le parcours ouvert quand la disponibilité est seulement indéterminée", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...quote,
          available: false,
          availabilityDegraded: true,
        }),
      ),
    );
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-continue")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("booking-unavailable")).toBeNull();
    expect(
      screen.getByTestId("booking-availability-degraded"),
    ).toBeInTheDocument();
  });

  it("404 : chambre introuvable → message dédié + sortie, sans bouton Réessayer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(404)));
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-not-found")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("booking-retry")).toBeNull();
    expect(screen.getByTestId("booking-error-exit")).toBeInTheDocument();
  });

  it("503 : dégradation PMS → message dédié + Réessayer (jamais de cul-de-sac)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));
    renderRecap();

    await waitFor(() =>
      expect(screen.getByTestId("booking-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("booking-error").textContent).toMatch(
      /indisponible/i,
    );
    expect(screen.getByTestId("booking-retry")).toBeInTheDocument();
    expect(screen.getByTestId("booking-error-exit")).toBeInTheDocument();
  });
});
