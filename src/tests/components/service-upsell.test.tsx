import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { ServiceUpsell } from "@/components/molecules/service-upsell";
import frMessages from "@/i18n/messages/fr.json";
import type {
  UpsellSelection,
  UpsellServiceResult,
} from "@/services/booking.service";

const SPA: UpsellServiceResult = {
  serviceId: "s-spa",
  name: "Spa",
  description: "Accès illimité",
  unitPrice: 3_000,
  currency: "EUR",
  unit: "par séance",
};

const BREAKFAST: UpsellServiceResult = {
  serviceId: "s-breakfast",
  name: "Petit-déjeuner",
  description: null,
  unitPrice: 1_250,
  currency: "EUR",
  unit: null,
};

function renderFr(
  services: UpsellServiceResult[] = [SPA, BREAKFAST],
  selection: UpsellSelection = {},
  overrides: Partial<{
    onChange: (next: UpsellSelection) => void;
    disabled: boolean;
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <ServiceUpsell
        services={services}
        selection={selection}
        onChange={onChange}
        currency="EUR"
        disabled={overrides.disabled ?? false}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onChange };
}

afterEach(cleanup);

describe("ServiceUpsell", () => {
  it("ne coche RIEN au montage — opt-in strict (UX-DR-9.7)", () => {
    renderFr();

    // Exigence produit, pas détail d'implémentation : une case pré-cochée est un dark pattern.
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("ne se rend pas du tout quand le catalogue est vide", () => {
    const { container } = renderFr([]);

    // Le tunnel ne doit pas afficher une section vide : sans service, il n'y a rien à dire.
    expect(container).toBeEmptyDOMElement();
  });

  it("annonce « aucun service » tant que rien n’est sélectionné", () => {
    renderFr();

    expect(screen.getByTestId("upsell-subtotal")).toHaveTextContent(
      "Aucun service ajouté.",
    );
  });

  it("sélectionne un service à la quantité 1 au premier clic", () => {
    const { onChange } = renderFr();

    fireEvent.click(screen.getByTestId("upsell-toggle-s-spa"));

    expect(onChange).toHaveBeenCalledWith({ "s-spa": 1 });
  });

  it("retire le service de la sélection au décochage, sans le laisser à 0", () => {
    const { onChange } = renderFr([SPA, BREAKFAST], { "s-spa": 2 });

    fireEvent.click(screen.getByTestId("upsell-toggle-s-spa"));

    // La clé disparaît : une entrée à 0 partirait au BFF et y serait refusée (@Min(1)).
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("met le sous-total à jour selon la quantité (anti drip-pricing)", () => {
    renderFr([SPA, BREAKFAST], { "s-spa": 2 });

    // 2 × 30 € = 60 €
    expect(screen.getByTestId("upsell-subtotal")).toHaveTextContent("60");
  });

  it("additionne plusieurs services dans le sous-total", () => {
    renderFr([SPA, BREAKFAST], { "s-spa": 1, "s-breakfast": 2 });

    // 30 € + 2 × 12,50 € = 55 €
    expect(screen.getByTestId("upsell-subtotal")).toHaveTextContent("55");
  });

  it("expose le sous-total en région polie, pour que son changement soit annoncé", () => {
    renderFr();

    expect(screen.getByTestId("upsell-subtotal")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("n’affiche le champ quantité que pour un service sélectionné", () => {
    renderFr([SPA, BREAKFAST], { "s-spa": 1 });

    expect(screen.getByTestId("upsell-quantity-s-spa")).toBeInTheDocument();
    expect(
      screen.queryByTestId("upsell-quantity-s-breakfast"),
    ).not.toBeInTheDocument();
  });

  it("retombe sur 1 quand la quantité est effacée, plutôt que de retirer le service", () => {
    const { onChange } = renderFr([SPA], { "s-spa": 3 });

    fireEvent.change(screen.getByTestId("upsell-quantity-s-spa"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith({ "s-spa": 1 });
  });

  it("borne la quantité au plafond du DTO BFF", () => {
    const { onChange } = renderFr([SPA], { "s-spa": 1 });

    fireEvent.change(screen.getByTestId("upsell-quantity-s-spa"), {
      target: { value: "500" },
    });

    // Sans cette borne, le BFF refuserait en 400 après un aller-retour réseau évitable.
    expect(onChange).toHaveBeenCalledWith({ "s-spa": 99 });
  });

  it("affiche l’unité de facturation telle quelle, sans l’interpréter", () => {
    renderFr([SPA]);

    expect(screen.getByText(/par séance/)).toBeInTheDocument();
  });

  it("associe chaque case à son libellé et sa description", () => {
    renderFr([SPA]);

    const checkbox = screen.getByTestId("upsell-toggle-s-spa");
    expect(checkbox).toHaveAccessibleName("Spa");
    expect(checkbox).toHaveAccessibleDescription("Accès illimité");
  });

  it("neutralise toutes les commandes pendant une soumission", () => {
    renderFr([SPA], { "s-spa": 1 }, { disabled: true });

    expect(screen.getByTestId("upsell-toggle-s-spa")).toBeDisabled();
    expect(screen.getByTestId("upsell-quantity-s-spa")).toBeDisabled();
  });

  it("n’annonce aucune rareté ni urgence (UX-DR-9.5)", () => {
    const { container } = renderFr();

    // Aucun stock résiduel n'est connu de cet écran : en afficher un serait au mieux périmé.
    expect(container.textContent).not.toMatch(/plus que|reste|derni/i);
  });
});
