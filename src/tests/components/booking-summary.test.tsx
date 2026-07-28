import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { BookingSummary } from "@/components/organisms/booking-summary";
import type { BookingQuoteResult } from "@/services/booking.service";
import frMessages from "@/i18n/messages/fr.json";

const quote: BookingQuoteResult = {
  hotelId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  hotelName: "Hôtel Colline",
  hotelCity: "Antananarivo",
  hotelLogoUrl: null,
  roomId: "22222222-2222-2222-2222-222222222222",
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

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BookingSummary", () => {
  afterEach(cleanup);

  it("affiche tout le contenu exigé par FR-7 : hôtel, chambre, dates, nuits, voyageurs, total", () => {
    renderFr(<BookingSummary quote={quote} />);

    const summary = screen.getByTestId("booking-summary");
    expect(summary.getAttribute("role")).toBe("complementary");
    expect(summary.getAttribute("aria-label")).toBe(
      "Récapitulatif de la réservation",
    );
    expect(summary.textContent).toContain("Hôtel Colline");
    expect(summary.textContent).toContain("Antananarivo");
    expect(screen.getByTestId("booking-room").textContent).toBe(
      "Double Confort",
    );
    // AC-1 énumère n° de chambre et capacité : le contrat les transporte, l'écran doit les rendre.
    expect(screen.getByTestId("booking-room-number").textContent).toBe("204");
    expect(screen.getByTestId("booking-room-capacity").textContent).toBe(
      "2 personnes",
    );
    expect(screen.getByTestId("booking-guests").textContent).toBe(
      "2 voyageurs",
    );
    // Ventilation « 84 € × 2 nuits » : le nombre de nuits et le tarif par nuit sont visibles.
    const breakdown = screen.getByTestId("booking-breakdown").textContent ?? "";
    expect(breakdown).toContain("84");
    expect(breakdown).toContain("2 nuits");
    // Total 16800 cents → 168 €.
    expect(screen.getByTestId("booking-total").textContent).toContain("168");
  });

  it("formate les dates du séjour dans la locale (jamais l’ISO brut)", () => {
    renderFr(<BookingSummary quote={quote} />);
    expect(screen.getByTestId("booking-check-in").textContent).not.toContain(
      "2999-07-05",
    );
    expect(screen.getByTestId("booking-check-out").textContent).not.toContain(
      "2999-07-07",
    );
  });

  /** AC-2 : le montant vit dans une région `aria-live` → chaque recalcul est annoncé. */
  it("annonce le total dans une région aria-live", () => {
    renderFr(<BookingSummary quote={quote} />);
    const live = screen
      .getByTestId("booking-total")
      .querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("168");
  });

  /** AC-5 : D7 non livré → état explicite, jamais une ligne de taxe chiffrée. */
  it("affiche un état de taxe explicite sans jamais chiffrer un montant", () => {
    renderFr(<BookingSummary quote={quote} />);
    const tax = screen.getByTestId("booking-tax-state").textContent ?? "";
    expect(tax).toMatch(/non détaillées/i);
    expect(tax).not.toMatch(/\d/);
  });

  it("bascule en squelette pendant un recalcul (jamais de blocage total)", () => {
    renderFr(<BookingSummary quote={quote} recalculating />);
    const total = screen.getByTestId("booking-total");
    expect(total.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("expose une barre repliable (mobile) pilotée par aria-expanded", () => {
    renderFr(<BookingSummary quote={quote} />);
    const toggle = screen.getByTestId("booking-summary-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      screen.getByTestId("booking-summary-panel").id,
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  /** AC-1 : le logo de l'Hôtel, décoratif (le nom porte l'information) mais bien rendu. */
  it("affiche le logo de l’hôtel quand il existe, et s’en passe sinon", () => {
    const { unmount } = renderFr(
      <BookingSummary
        quote={{ ...quote, hotelLogoUrl: "https://pms/img/logo.png" }}
      />,
    );
    expect(screen.getByTestId("booking-hotel-logo")).toBeInTheDocument();
    unmount();

    renderFr(<BookingSummary quote={{ ...quote, hotelLogoUrl: null }} />);
    expect(screen.queryByTestId("booking-hotel-logo")).toBeNull();
    // Le nom reste affiché : l'absence de logo n'enlève aucune information.
    expect(screen.getByTestId("booking-summary").textContent).toContain(
      "Hôtel Colline",
    );
  });

  it("porte la politique d’annulation en repli (D2) au sein du récapitulatif", () => {
    renderFr(<BookingSummary quote={quote} />);
    expect(
      screen.getByTestId("cancellation-policy-fallback"),
    ).toBeInTheDocument();
  });

  /**
   * Ordre CRITIQUE hérité de la story 1.10 : une panne du cross-check de disponibilité ne doit
   * JAMAIS s'afficher « indisponible » — elle affiche « à confirmer ».
   */
  it("affiche « à confirmer » (et non « indisponible ») quand la disponibilité est dégradée", () => {
    renderFr(
      <BookingSummary
        quote={{ ...quote, available: false, availabilityDegraded: true }}
      />,
    );
    expect(
      screen.getByTestId("booking-availability-degraded"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("booking-unavailable-notice")).toBeNull();
  });

  it("signale une chambre réellement indisponible (icône + texte, jamais la couleur seule)", () => {
    renderFr(
      <BookingSummary
        quote={{ ...quote, available: false, availabilityDegraded: false }}
      />,
    );
    const notice = screen.getByTestId("booking-unavailable-notice");
    expect(notice.textContent).toMatch(/plus disponible/i);
    expect(notice.querySelector("svg")).not.toBeNull();
  });

  it("porte la devise de l’hôtel avec son exposant réel (MGA = 0 décimale)", () => {
    renderFr(
      <BookingSummary
        quote={{
          ...quote,
          currency: "MGA",
          pricePerNight: 250_000,
          roomTotal: 500_000,
          total: 500_000,
        }}
      />,
    );
    // 500 000 unités mineures MGA = 500 000 MGA (et non 5 000).
    expect(screen.getByTestId("booking-total").textContent).toMatch(
      /500[\s  ]?000/,
    );
  });
});
