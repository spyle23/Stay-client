import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { HotelDetail } from "@/components/organisms/hotel-detail";
import type { HotelDetailResult } from "@/services/catalog.service";
import frMessages from "@/i18n/messages/fr.json";

const hotel: HotelDetailResult = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  name: "Hôtel de la Paix",
  category: "4-star",
  description: "Un établissement au cœur de la ville.",
  address: "1 rue de la Paix",
  city: "Antananarivo",
  country: "Madagascar",
  postalCode: "101",
  latitude: -18.9,
  longitude: 47.5,
  phone: null,
  email: null,
  currency: "EUR",
  locale: "fr-FR",
  logoUrl: "https://img/logo.png",
  roomCount: 2,
  gallery: [{ url: "https://img/logo.png", roomNumber: null }],
  stayNights: 2,
  rooms: [
    {
      id: "r1",
      hotelId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      number: "101",
      category: "Suite",
      capacity: 2,
      amenities: "Wifi",
      floor: 1,
      pricePerNight: 12000,
      totalPrice: 24000,
      currency: "EUR",
      nights: 2,
    },
  ],
  roomsUnavailable: false,
};

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("HotelDetail (intégration)", () => {
  afterEach(cleanup);

  it("assemble identité, galerie, chambres et localisation ; surface accent hôtel", () => {
    renderFr(<HotelDetail hotel={hotel} />);
    const root = screen.getByTestId("hotel-detail");
    // Accent hôtel appliqué sur la surface (mécanisme AC-5).
    expect(root.hasAttribute("data-hotel-theme")).toBe(true);
    expect(
      screen.getByRole("heading", { level: 1, name: "Hôtel de la Paix" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hotel-category").textContent).toContain(
      "4-star",
    );
    expect(screen.getByTestId("hotel-gallery")).toBeInTheDocument();
    expect(screen.getByTestId("room-card")).toBeInTheDocument();
    // Localisation : lien carte externe (coords présentes), nouvel onglet + noopener.
    const mapLink = screen.getByTestId("hotel-map-link");
    expect(mapLink.getAttribute("target")).toBe("_blank");
    expect(mapLink.getAttribute("rel")).toContain("noopener");
    expect(mapLink.getAttribute("href")).toContain("openstreetmap");
  });

  it("état « aucune chambre » distinct de la dégradation", () => {
    renderFr(<HotelDetail hotel={{ ...hotel, rooms: [] }} />);
    expect(screen.getByTestId("rooms-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("rooms-degraded")).toBeNull();
  });

  it("état dégradé quand la disponibilité des chambres est injoignable", () => {
    renderFr(
      <HotelDetail hotel={{ ...hotel, rooms: [], roomsUnavailable: true }} />,
    );
    expect(screen.getByTestId("rooms-degraded")).toBeInTheDocument();
    expect(screen.queryByTestId("rooms-empty")).toBeNull();
  });

  it("sans dates : invite à choisir des dates (prix par nuit)", () => {
    renderFr(
      <HotelDetail
        hotel={{
          ...hotel,
          stayNights: null,
          rooms: [{ ...hotel.rooms[0], totalPrice: null, nights: null }],
        }}
      />,
    );
    expect(screen.getByTestId("rooms-select-dates")).toBeInTheDocument();
  });

  /**
   * Revue : sans dates ET sans chambre, dire « aucune chambre pour ces dates » ferait croire à
   * l'utilisateur que l'hôtel est complet, alors qu'il n'a saisi aucune date.
   */
  it("sans dates ET sans chambre : explique qu'il faut choisir des dates", () => {
    renderFr(<HotelDetail hotel={{ ...hotel, stayNights: null, rooms: [] }} />);
    const empty = screen.getByTestId("rooms-empty");
    expect(empty.textContent).toContain("Choisissez vos dates");
    expect(empty.textContent).not.toContain("pour ces dates");
  });

  it("localisation sans coordonnées : adresse seule, sans lien mort", () => {
    renderFr(
      <HotelDetail hotel={{ ...hotel, latitude: null, longitude: null }} />,
    );
    expect(screen.queryByTestId("hotel-map-link")).toBeNull();
    expect(screen.getByTestId("hotel-location")).toBeInTheDocument();
  });
});
