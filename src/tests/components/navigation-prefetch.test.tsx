import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";

import { HotelCard } from "@/components/molecules/hotel-card";
import { RoomCard } from "@/components/molecules/room-card";
import type { HotelRoomResult } from "@/services/catalog.service";
import type { HotelAvailabilityResult } from "@/services/search.service";
import frMessages from "@/i18n/messages/fr.json";

/**
 * Liens vers les fiches SSR sans préchargement automatique (spyle23/hotelerie#148, AC-2).
 *
 * En production, un clic sur une carte pendant le préchargement « jusqu'au squelette » de sa fiche
 * pouvait laisser la fiche blanche (le routeur validait la navigation sur le segment vide du
 * préchargement). Sans préchargement, la navigation passe par une seule requête RSC : squelette
 * dès les premiers octets, puis la fiche. Le parcours est couvert en production par
 * `src/tests/e2e/prod/hotel-navigation.prod.spec.ts` ; ici, le contrat du lien.
 */
const linkProps: Array<ComponentProps<"a"> & { prefetch?: unknown }> = [];

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: unknown }) => {
    linkProps.push({ prefetch, ...rest });
    return <a {...rest}>{children}</a>;
  },
}));

const hotel: HotelAvailabilityResult = {
  hotelId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  name: "Hôtel A",
  city: "Paris",
  country: "France",
  category: "4",
  currency: "EUR",
  fromPricePerNight: 12000,
  fromTotalPrice: 36000,
  nights: 3,
  availableRoomCount: 2,
  thumbnailUrl: null,
  latitude: null,
  longitude: null,
  distanceKm: null,
  amenities: [],
};

const room: HotelRoomResult = {
  id: "11111111-1111-1111-1111-111111111111",
  hotelId: hotel.hotelId,
  number: "101",
  category: "Double",
  capacity: 2,
  amenities: null,
  floor: 1,
  pricePerNight: 12000,
  totalPrice: 36000,
  currency: "EUR",
  nights: 3,
};

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function propsOf(testId: string) {
  const props = linkProps.find((p) => p["data-testid" as never] === testId);
  expect(props, `lien ${testId} rendu`).toBeDefined();
  return props!;
}

describe("Liens vers les fiches SSR — sans préchargement automatique (#148)", () => {
  afterEach(() => {
    cleanup();
    linkProps.length = 0;
  });

  it("la carte d'hôtel (lien vers la fiche hôtel) désactive le préchargement", () => {
    renderFr(<HotelCard hotel={hotel} href="/hotels/hotel-a-x?guests=2" />);
    expect(propsOf("hotel-card").prefetch).toBe(false);
    expect(propsOf("hotel-card").href).toBe("/hotels/hotel-a-x?guests=2");
  });

  it("le CTA d'une chambre (lien vers la fiche chambre) désactive le préchargement", () => {
    renderFr(<RoomCard room={room} hotelName="Hôtel A" />);
    const cta = propsOf("room-card-cta");
    expect(cta.prefetch).toBe(false);
    expect(String(cta.href)).toContain("/rooms/");
  });
});
