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

  it("rend le CTA « Réserver » en lien vers la fiche chambre, contexte préservé (pas de lien mort)", () => {
    renderFr(
      <RoomCard
        room={baseRoom}
        hotelName="Hôtel de la Paix"
        context={{
          checkInDate: "2999-01-02",
          checkOutDate: "2999-01-04",
          guests: 2,
          currency: "EUR",
        }}
      />,
    );
    const cta = screen.getByTestId("room-card-cta");
    expect(cta.tagName).toBe("A");
    const href = cta.getAttribute("href") ?? "";
    expect(href).toContain("/hotels/hotel-de-la-paix-h1/rooms/r1");
    expect(href).toContain("checkInDate=2999-01-02");
    expect(href).toContain("guests=2");
    expect(href).toContain("currency=EUR");
    expect(cta.textContent).toContain("Réserver");
  });

  it("le CTA reste un lien valide sans contexte de séjour (slug par GUID)", () => {
    renderFr(<RoomCard room={baseRoom} />);
    const cta = screen.getByTestId("room-card-cta");
    expect(cta.getAttribute("href")).toBe("/hotels/h1/rooms/r1");
  });

  /**
   * Revue : le `hotelId` fourni (garanti valide par la page) prime sur `room.hotelId`, que le BFF
   * coerce en `''` si le PMS l'omet — sinon le slug n'aurait pas de GUID de fin → lien mort (404).
   */
  it("préfère le hotelId fourni à un room.hotelId vide (pas de lien mort)", () => {
    const HOTEL_GUID = "99999999-9999-9999-9999-999999999999";
    renderFr(
      <RoomCard
        room={{ ...baseRoom, hotelId: "" }}
        hotelId={HOTEL_GUID}
        hotelName="Hôtel X"
      />,
    );
    const href = screen.getByTestId("room-card-cta").getAttribute("href") ?? "";
    expect(href).toBe(`/hotels/hotel-x-${HOTEL_GUID}/rooms/r1`);
    expect(href).not.toContain("/hotels//"); // jamais un segment hôtel vide
  });

  /**
   * Story 2.2 : plus aucune promesse d'annulation gratuite ici. Le PMS n'expose pas de politique
   * par hôtel (D2) — les conditions sont présentées **avant paiement** au récapitulatif du tunnel
   * (`CancellationPolicyDisclosure`), jamais affirmées sur une carte.
   */
  it("affiche les équipements, sans aucune promesse d'annulation gratuite", () => {
    renderFr(<RoomCard room={baseRoom} />);
    expect(document.querySelector('[data-trust-badge="free"]')).toBeNull();
    expect(screen.queryByText(/annulation gratuite/i)).toBeNull();
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
