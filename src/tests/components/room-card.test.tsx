import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { RoomCard } from "@/components/molecules/room-card";
import type { HotelRoomResult } from "@/services/catalog.service";
import frMessages from "@/i18n/messages/fr.json";

const baseRoom: HotelRoomResult = {
  id: "r1",
  hotelId: "h1",
  number: "101",
  category: "Suite",
  capacity: 2,
  amenities: "Wifi, Climatisation",
  floor: 1,
  pricePerNight: 12000,
  totalPrice: 24000,
  currency: "EUR",
  nights: 2,
};

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RoomCard", () => {
  afterEach(cleanup);

  it("affiche le total du séjour quand des dates sont en contexte (240 €)", () => {
    renderFr(<RoomCard room={baseRoom} />);
    const price = screen.getByTestId("room-card-price");
    expect(price.textContent).toContain("240"); // 24000 cents
  });

  it("affiche le prix par nuit quand aucune date (total/nights null)", () => {
    renderFr(
      <RoomCard room={{ ...baseRoom, totalPrice: null, nights: null }} />,
    );
    const price = screen.getByTestId("room-card-price");
    expect(price.textContent).toContain("120"); // 12000 cents / nuit
    expect(screen.getByText("par nuit")).toBeInTheDocument();
  });

  it("rend le CTA « Réserver » désactivé (pas de lien mort, Décision 7)", () => {
    renderFr(<RoomCard room={baseRoom} />);
    const cta = screen.getByTestId("room-card-cta");
    expect(cta).toBeDisabled();
    expect(cta.textContent).toContain("Bientôt disponible");
  });

  it("affiche le badge d'annulation gratuite (repli D2) et les équipements", () => {
    renderFr(<RoomCard room={baseRoom} />);
    expect(document.querySelector('[data-trust-badge="free"]')).not.toBeNull();
    expect(screen.getByText("Wifi")).toBeInTheDocument();
    expect(screen.getByText("Climatisation")).toBeInTheDocument();
  });

  it("affiche la capacité (pluriel ICU)", () => {
    renderFr(<RoomCard room={baseRoom} />);
    expect(screen.getByText(/2 voyageurs/)).toBeInTheDocument();
  });

  it("gère une chambre sans équipements", () => {
    renderFr(<RoomCard room={{ ...baseRoom, amenities: null }} />);
    expect(screen.getByTestId("room-card")).toBeInTheDocument();
  });

  /** Revue : « 0 voyageur » ne doit jamais s'afficher sur une chambre réservable. */
  it("masque la capacité quand le PMS ne la renseigne pas (jamais « 0 voyageur »)", () => {
    renderFr(<RoomCard room={{ ...baseRoom, capacity: null }} />);
    expect(screen.queryByText(/voyageur/)).toBeNull();
    expect(screen.getByTestId("room-card")).toBeInTheDocument();
  });

  /** Revue : ne pas scinder sur `/` (« 24/7 ») et dé-dupliquer (clés React en collision). */
  it("ne scinde pas les équipements sur « / » et dé-duplique les doublons", () => {
    renderFr(
      <RoomCard
        room={{ ...baseRoom, amenities: "Wifi, 24/7 room service, Wifi" }}
      />,
    );
    expect(screen.getByText("24/7 room service")).toBeInTheDocument();
    expect(screen.getAllByText("Wifi")).toHaveLength(1);
  });
});
