import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { SearchResults } from "@/components/organisms/search-results";
import type { HotelAvailabilityResult } from "@/services/search.service";
import type { SearchHotelsParams } from "@/services/search.service";
import frMessages from "@/i18n/messages/fr.json";

// La barre d'outils de filtres (story 1.8) utilise `useRouter` — mock App Router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const params: SearchHotelsParams = {
  destination: "Antananarivo",
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

const sample: HotelAvailabilityResult = {
  hotelId: "h1",
  name: "Hôtel A",
  city: "Antananarivo",
  country: "Madagascar",
  category: "4-star",
  currency: "EUR",
  fromPricePerNight: 12000,
  fromTotalPrice: 24000,
  nights: 2,
  availableRoomCount: 2,
  thumbnailUrl: null,
  latitude: null,
  longitude: null,
  distanceKm: null,
  amenities: [],
};

function okResponse(hotels: HotelAvailabilityResult[]) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: true,
        data: hotels,
        pagination: {
          page: 1,
          pageSize: 12,
          totalCount: hotels.length,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      }),
  };
}

const nearbyParams: SearchHotelsParams = {
  mode: "nearby",
  latitude: -18.9,
  longitude: 47.5,
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

function renderResults(searchParams: SearchHotelsParams = params) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <SearchResults params={searchParams} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SearchResults (intégration React Query ↔ BFF mocké)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("affiche des skeletons pendant le chargement", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    renderResults();
    expect(screen.getByTestId("results-loading")).toBeInTheDocument();
  });

  it("affiche les cartes d'hôtels au succès", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([sample])));
    renderResults();
    await waitFor(() =>
      expect(screen.getByTestId("hotel-card")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("results-count")).toBeInTheDocument();
  });

  it("affiche l'état vide (élargir dates/zone) quand aucun hôtel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([])));
    renderResults();
    await waitFor(() =>
      expect(screen.getByTestId("results-empty")).toBeInTheDocument(),
    );
  });

  it("affiche la barre d'outils de filtres au succès", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([sample])));
    renderResults();
    await waitFor(() =>
      expect(screen.getByTestId("results-toolbar")).toBeInTheDocument(),
    );
  });

  it("état vide filtré (desserrer les filtres) quand un filtre est actif et 0 résultat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([])));
    renderResults({ ...params, minPrice: 50000 });
    await waitFor(() =>
      expect(screen.getByTestId("results-empty-filtered")).toBeInTheDocument(),
    );
  });

  it("affiche l'état dégradé (distinct de vide) sur 503 PMS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({ success: false, message: "PMS indisponible" }),
      }),
    );
    renderResults();
    await waitFor(() =>
      expect(screen.getByTestId("results-degraded")).toBeInTheDocument(),
    );
  });

  it("mode proximité : affiche les distances et un état vide « élargir la zone »", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([])));
    renderResults(nearbyParams);
    await waitFor(() =>
      expect(screen.getByTestId("results-empty")).toBeInTheDocument(),
    );
    // Copie proximité (distincte de la destination) : « à proximité ».
    expect(screen.getByText(/proximité/i)).toBeInTheDocument();
  });

  it("mode proximité : rend une carte avec sa distance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse([{ ...sample, distanceKm: 2.5 }])),
    );
    renderResults(nearbyParams);
    await waitFor(() =>
      expect(screen.getByTestId("hotel-card")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("hotel-card-distance")).toBeInTheDocument();
  });
});
