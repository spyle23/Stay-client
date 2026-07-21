import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { RoomDetail } from "@/components/organisms/room-detail";
import type { RoomDetailResult, StayContext } from "@/services/catalog.service";
import frMessages from "@/i18n/messages/fr.json";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

const baseRoom: RoomDetailResult = {
  id: ROOM_ID,
  hotelId: HOTEL_ID,
  hotelName: "Hôtel de la Paix",
  hotelCity: "Antananarivo",
  number: "101",
  category: "Suite",
  capacity: 2,
  amenities: "Wifi, Climatisation",
  floor: 1,
  description: "Vue sur mer.",
  includedServices: [
    { name: "Petit-déjeuner", quantity: 2, notes: null },
    { name: "Spa", quantity: null, notes: "sur réservation" },
  ],
  images: [{ url: "https://img/room1.png" }],
  pricePerNight: 12000,
  totalPrice: 24000,
  currency: "EUR",
  nights: 2,
  available: true,
  availabilityDegraded: false,
};

const context: StayContext = {
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RoomDetail (intégration)", () => {
  afterEach(cleanup);

  it("assemble titre, capacité, total, équipements, services inclus + accent hôtel + galerie", () => {
    renderFr(<RoomDetail room={baseRoom} context={context} />);
    const root = screen.getByTestId("room-detail");
    expect(root.hasAttribute("data-hotel-theme")).toBe(true);
    expect(
      screen.getByRole("heading", { level: 1, name: "Suite" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 voyageurs/)).toBeInTheDocument();
    expect(screen.getByTestId("room-detail-price").textContent).toContain(
      "240", // total 24000 cents
    );
    expect(screen.getByText("Wifi")).toBeInTheDocument();
    const services = screen.getByTestId("room-included-services");
    expect(services.textContent).toContain("Petit-déjeuner");
    expect(services.textContent).toContain("×2");
    expect(services.textContent).toContain("sur réservation");
    expect(screen.getByTestId("hotel-gallery")).toBeInTheDocument();
  });

  it("disponible : CTA « Réserver » lien vers le tunnel en conservant hôtel/chambre/dates", () => {
    renderFr(<RoomDetail room={baseRoom} context={context} />);
    const cta = screen.getByTestId("room-book-cta");
    expect(cta.tagName).toBe("A");
    const href = cta.getAttribute("href") ?? "";
    expect(href).toContain("/booking?");
    expect(href).toContain(`hotelId=${HOTEL_ID}`);
    expect(href).toContain(`roomId=${ROOM_ID}`);
    expect(href).toContain("checkInDate=2999-01-02");
    expect(href).toContain("currency=EUR");
  });

  it("prix par nuit quand aucune date en contexte", () => {
    renderFr(
      <RoomDetail
        room={{ ...baseRoom, totalPrice: null, nights: null }}
        context={{}}
      />,
    );
    expect(screen.getByTestId("room-detail-price").textContent).toContain(
      "120",
    );
    expect(screen.getByText("par nuit")).toBeInTheDocument();
  });

  it("indisponible : bloc explicite « pour ces dates » + CTA désactivé (pas de lien mort)", () => {
    renderFr(
      <RoomDetail room={{ ...baseRoom, available: false }} context={context} />,
    );
    const block = screen.getByTestId("room-unavailable");
    expect(block.textContent).toContain("pour ces dates");
    expect(screen.getByTestId("room-book-cta-disabled")).toBeDisabled();
    expect(screen.queryByTestId("room-book-cta")).toBeNull();
  });

  it("indisponible sans dates : message générique (jamais « pour ces dates »)", () => {
    renderFr(
      <RoomDetail
        room={{
          ...baseRoom,
          available: false,
          totalPrice: null,
          nights: null,
        }}
        context={{}}
      />,
    );
    expect(screen.getByTestId("room-unavailable").textContent).not.toContain(
      "pour ces dates",
    );
  });

  it("disponibilité dégradée : avis discret + CTA actif, jamais « indisponible »", () => {
    renderFr(
      <RoomDetail
        room={{ ...baseRoom, availabilityDegraded: true }}
        context={context}
      />,
    );
    expect(
      screen.getByTestId("room-availability-degraded"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("room-book-cta")).toBeInTheDocument();
    expect(screen.queryByTestId("room-unavailable")).toBeNull();
  });

  /**
   * Revue (AC-6) : dégradé ET statiquement inéligible (`available:false`) — une panne du cross-check
   * daté ne doit JAMAIS se présenter « indisponible pour ces dates » ; on montre « à confirmer » et
   * un CTA désactivé (pas de lien mort).
   */
  it("dégradé + indisponible statique : avis « à confirmer », jamais « pour ces dates » + CTA désactivé", () => {
    renderFr(
      <RoomDetail
        room={{ ...baseRoom, available: false, availabilityDegraded: true }}
        context={context}
      />,
    );
    expect(
      screen.getByTestId("room-availability-degraded"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("room-unavailable")).toBeNull();
    expect(screen.getByTestId("room-book-cta-disabled")).toBeDisabled();
    expect(screen.queryByTestId("room-book-cta")).toBeNull();
    expect(document.body.textContent).not.toContain("pour ces dates");
  });

  it("lien retour vers la fiche hôtel (contexte préservé, pas vers la fiche chambre)", () => {
    renderFr(<RoomDetail room={baseRoom} context={context} />);
    const href =
      screen.getByTestId("room-back-to-hotel").getAttribute("href") ?? "";
    expect(href).toContain(`/hotels/hotel-de-la-paix-${HOTEL_ID}`);
    expect(href).toContain("checkInDate=2999-01-02");
    expect(href).not.toContain("/rooms/");
  });

  it("capacité absente : jamais « 0 voyageur »", () => {
    renderFr(
      <RoomDetail room={{ ...baseRoom, capacity: null }} context={context} />,
    );
    expect(screen.queryByText(/voyageur/)).toBeNull();
  });
});
