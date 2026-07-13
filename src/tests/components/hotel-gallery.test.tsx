import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { HotelGallery } from "@/components/organisms/hotel-gallery";
import type { HotelGalleryImage } from "@/services/catalog.service";
import frMessages from "@/i18n/messages/fr.json";

const images: HotelGalleryImage[] = [
  { url: "https://img/hero.png", roomNumber: null }, // image de l'établissement (logo)
  { url: "https://img/r1.png", roomNumber: "101" },
];

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("HotelGallery", () => {
  afterEach(cleanup);

  /** L'`alt` est composé côté front (i18n) — un `alt` en dur du BFF serait servi en fr aux `en`. */
  it("compose un texte alternatif localisé (établissement vs chambre)", () => {
    renderFr(<HotelGallery images={images} hotelName="Hôtel A" />);
    expect(
      screen.getByAltText("Hôtel A — photo de l’établissement"),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Hôtel A — chambre 101")).toBeInTheDocument();
  });

  it("affiche un placeholder propre quand aucune image (jamais d'image cassée)", () => {
    renderFr(<HotelGallery images={[]} hotelName="Hôtel A" />);
    expect(screen.getByTestId("hotel-gallery")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
