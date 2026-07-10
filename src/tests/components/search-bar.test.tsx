import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import {
  SearchBar,
  type SearchBarDefaults,
} from "@/components/organisms/search-bar";
import { CurrencyProvider } from "@/contexts/currency-context";
import frMessages from "@/i18n/messages/fr.json";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type SuccessCb = (position: GeolocationPosition) => void;
type ErrorCb = (error: GeolocationPositionError) => void;

function stubGeolocation(
  getCurrentPosition: (success: SuccessCb, error?: ErrorCb) => void,
): void {
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
}

function renderSearchBar() {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <CurrencyProvider initialCurrency="EUR">
        <SearchBar variant="hero" />
      </CurrencyProvider>
    </NextIntlClientProvider>,
  );
}

function renderNearMe(defaults?: SearchBarDefaults) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <CurrencyProvider initialCurrency="EUR">
        <SearchBar variant="hero" geolocationEnabled defaults={defaults} />
      </CurrencyProvider>
    </NextIntlClientProvider>,
  );
}

const FUTURE_DATES: SearchBarDefaults = {
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-05",
  guests: 2,
};

describe("SearchBar", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
  });

  it("rend les contrôles de recherche", () => {
    renderSearchBar();
    expect(screen.getByTestId("search-destination")).toBeInTheDocument();
    expect(screen.getByTestId("date-range-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("guest-selector-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("search-submit")).toBeInTheDocument();
  });

  it("rejette une soumission sans dates : erreurs affichées, AUCUNE navigation (aucun appel BFF)", () => {
    renderSearchBar();
    fireEvent.change(screen.getByTestId("search-destination"), {
      target: { value: "Paris" },
    });
    fireEvent.click(screen.getByTestId("search-submit"));

    expect(screen.getByTestId("search-errors")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("rejette une destination vide", () => {
    renderSearchBar();
    fireEvent.click(screen.getByTestId("search-submit"));
    const errors = screen.getByTestId("search-errors");
    expect(errors).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("n'affiche pas « Autour de moi » sans geolocationEnabled", () => {
    renderSearchBar();
    expect(screen.queryByTestId("search-near-me")).toBeNull();
  });
});

describe("SearchBar — Autour de moi (géoloc, FR-2)", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
  });

  it("affiche le déclencheur un-tap quand geolocationEnabled", () => {
    stubGeolocation(() => undefined);
    renderNearMe();
    expect(screen.getByTestId("search-near-me")).toBeInTheDocument();
  });

  it("sans dates → erreurs, la géoloc n'est PAS déclenchée, pas de navigation", () => {
    const geoSpy = vi.fn();
    stubGeolocation(geoSpy);
    renderNearMe();
    fireEvent.click(screen.getByTestId("search-near-me"));
    expect(screen.getByTestId("search-errors")).toBeInTheDocument();
    expect(geoSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("refus de géoloc → message explicatif + repli (pas de navigation)", async () => {
    stubGeolocation((_success, error) =>
      error?.({ code: 1 } as GeolocationPositionError),
    );
    renderNearMe(FUTURE_DATES);
    fireEvent.click(screen.getByTestId("search-near-me"));
    await waitFor(() =>
      expect(screen.getByTestId("geolocation-error")).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("succès de géoloc → navigation en mode proximité (coordonnées dans l'URL)", async () => {
    stubGeolocation((success) =>
      success({
        coords: { latitude: -18.9, longitude: 47.5 },
      } as GeolocationPosition),
    );
    renderNearMe(FUTURE_DATES);
    fireEvent.click(screen.getByTestId("search-near-me"));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const url = String(pushMock.mock.calls[0][0]);
    expect(url).toContain("mode=nearby");
    expect(url).toContain("latitude=-18.9");
    expect(url).toContain("longitude=47.5");
  });
});
