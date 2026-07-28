import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { HotelCard } from "@/components/molecules/hotel-card";
import type { HotelAvailabilityResult } from "@/services/search.service";
import frMessages from "@/i18n/messages/fr.json";

const hotel: HotelAvailabilityResult = {
  hotelId: "h1",
  name: "Hôtel A",
  city: "Antananarivo",
  country: "Madagascar",
  category: "4-star",
  currency: "EUR",
  fromPricePerNight: 12000,
  fromTotalPrice: 24000,
  nights: 2,
  availableRoomCount: 3,
  thumbnailUrl: null,
  latitude: null,
  longitude: null,
  distanceKm: null,
  amenities: [],
};

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("HotelCard", () => {
  afterEach(cleanup);

  it("expose nom, ville, note de catégorie et prix « à partir de »", () => {
    renderFr(<HotelCard hotel={hotel} />);
    expect(screen.getByTestId("hotel-card")).toBeInTheDocument();
    expect(screen.getByText("Hôtel A")).toBeInTheDocument();
    expect(screen.getByText("Antananarivo")).toBeInTheDocument();
    expect(screen.getByTestId("hotel-card-category").textContent).toContain(
      "4-star",
    );
    // fromTotalPrice 24000 cents → 240 €
    expect(screen.getByTestId("hotel-card-price").textContent).toContain("240");
  });

  /**
   * Story 2.2 : le badge « annulation gratuite » a été retiré. Le PMS n'expose aucune politique
   * par hôtel (dépendance D2) — promettre une gratuité sans donnée est un dark pattern
   * (UX-DR-9.5). Les conditions sont désormais présentées avant paiement, dans le tunnel.
   * Seul « Disponibilité réelle » subsiste : il est factuel (liste availability-first).
   */
  it("affiche le badge de disponibilité, et AUCUNE promesse d'annulation gratuite", () => {
    renderFr(<HotelCard hotel={hotel} />);
    expect(document.querySelector('[data-trust-badge="avail"]')).not.toBeNull();
    expect(document.querySelector('[data-trust-badge="free"]')).toBeNull();
    expect(screen.queryByText(/annulation gratuite/i)).toBeNull();
  });

  it("bascule en densité compacte via la prop", () => {
    renderFr(<HotelCard hotel={hotel} density="compact" />);
    expect(screen.getByTestId("hotel-card").getAttribute("data-density")).toBe(
      "compact",
    );
  });

  it("utilise un placeholder quand la photo est absente (nom en alt sinon)", () => {
    renderFr(<HotelCard hotel={{ ...hotel, name: null }} />);
    // Nom de repli i18n quand null.
    expect(screen.getByText("Hôtel")).toBeInTheDocument();
  });

  it("affiche la distance en mode proximité (distanceKm non null)", () => {
    renderFr(<HotelCard hotel={{ ...hotel, distanceKm: 1.2 }} />);
    const distance = screen.getByTestId("hotel-card-distance");
    expect(distance.textContent).toContain("1,2"); // format fr (virgule décimale)
    expect(distance.textContent).toContain("km");
  });

  it("n'affiche pas de distance quand distanceKm est null (mode destination)", () => {
    renderFr(<HotelCard hotel={hotel} />);
    expect(screen.queryByTestId("hotel-card-distance")).toBeNull();
  });

  // Story 1.9 (AC-12) : la carte devient un lien vers la fiche hôtel.
  it("est un lien vers la fiche hôtel quand href est fourni", () => {
    renderFr(<HotelCard hotel={hotel} href="/hotels/hotel-a-h1?guests=2" />);
    const card = screen.getByTestId("hotel-card");
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toContain("/hotels/hotel-a-h1");
    expect(card.getAttribute("href")).toContain("guests=2");
  });

  it("reste un article (non-lien) quand href est absent", () => {
    renderFr(<HotelCard hotel={hotel} />);
    expect(screen.getByTestId("hotel-card").tagName).toBe("ARTICLE");
  });
});
