import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { ResultsToolbar } from "@/components/organisms/results-toolbar";
import type { SearchFacets } from "@/lib/search-facets";
import type { SearchHotelsParams } from "@/services/search.service";
import frMessages from "@/i18n/messages/fr.json";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const facets: SearchFacets = {
  categories: ["4-star", "Boutique"],
  amenities: ["WiFi"],
  priceBounds: { min: 8000, max: 30000 },
};

const destination: SearchHotelsParams = {
  mode: "destination",
  destination: "Antananarivo",
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

const nearby: SearchHotelsParams = {
  mode: "nearby",
  latitude: -18.9,
  longitude: 47.5,
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

function renderToolbar(params: SearchHotelsParams, f: SearchFacets = facets) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <ResultsToolbar params={params} facets={f} />
    </NextIntlClientProvider>,
  );
}

describe("ResultsToolbar", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("propose distance uniquement en mode proximité", () => {
    renderToolbar(destination);
    expect(screen.getByTestId("sort-relevance")).toBeInTheDocument();
    expect(screen.queryByTestId("sort-distance")).toBeNull();
    cleanup();
    renderToolbar(nearby);
    expect(screen.getByTestId("sort-distance")).toBeInTheDocument();
  });

  it("cliquer un tri pousse une URL avec le bon param", () => {
    renderToolbar(destination);
    fireEvent.click(screen.getByTestId("sort-price_asc"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(String(pushMock.mock.calls[0][0])).toContain("sort=price_asc");
  });

  it("basculer une catégorie pousse une URL avec category=", () => {
    renderToolbar(destination);
    fireEvent.click(screen.getByTestId("filter-category-4-star"));
    expect(String(pushMock.mock.calls[0][0])).toContain("category=4-star");
  });

  it("saisir un prix min (unités majeures) pousse des cents", () => {
    renderToolbar(destination);
    const input = screen.getByTestId("filter-price-min");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);
    expect(String(pushMock.mock.calls[0][0])).toContain("minPrice=15000");
  });

  it("masque les équipements quand la facette est vide (repli D9)", () => {
    renderToolbar(destination, { ...facets, amenities: [] });
    expect(screen.queryByTestId("filter-amenities-wifi")).toBeNull();
  });

  it("réinitialise les filtres quand un filtre est actif", () => {
    renderToolbar({ ...destination, minPrice: 10000 });
    fireEvent.click(screen.getByTestId("filters-reset"));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(String(pushMock.mock.calls[0][0])).not.toContain("minPrice");
  });

  it("chip orphelin (sélection hors facette) reste visible et désélectionnable (P2)", () => {
    // « Palace » sélectionné mais absent des facettes → chip actif rendu quand même.
    renderToolbar(
      { ...destination, category: ["Palace"] },
      { ...facets, categories: ["4-star"] },
    );
    expect(screen.getByTestId("filter-category-palace")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("accumule les changements en lisant l'URL live, pas le prop stale (D1)", () => {
    // Une sélection déjà présente dans l'URL doit coexister avec la nouvelle.
    window.history.replaceState({}, "", "/search?category=Boutique");
    renderToolbar({ ...destination, category: ["Boutique"] });
    fireEvent.click(screen.getByTestId("filter-category-4-star"));
    const url = String(pushMock.mock.calls[0][0]);
    expect(url).toContain("category=Boutique");
    expect(url).toContain("category=4-star");
  });

  it("pousse en navigation douce (scroll: false) pour préserver la position (P4)", () => {
    renderToolbar(destination);
    fireEvent.click(screen.getByTestId("sort-price_asc"));
    expect(pushMock.mock.calls[0][1]).toEqual({ scroll: false });
  });
});
