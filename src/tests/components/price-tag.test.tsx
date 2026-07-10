import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import frMessages from "@/i18n/messages/fr.json";

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PriceTag", () => {
  afterEach(cleanup);

  it("formate un montant en cents dans la devise (24000 → 240 €)", () => {
    renderFr(
      <PriceTag
        amount={24000}
        currency="EUR"
        caption="total 2 nuits"
        data-testid="pt"
      />,
    );
    const el = screen.getByTestId("pt");
    expect(el.textContent).toContain("240");
    expect(el.textContent).toContain("€");
    expect(el.textContent).toContain("total 2 nuits");
  });

  it("annonce le montant via aria-live (recalcul)", () => {
    renderFr(<PriceTag amount={16850} currency="EUR" data-testid="pt2" />);
    const live = screen
      .getByTestId("pt2")
      .querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("168,50");
  });

  it("affiche un skeleton aria-busy en chargement", () => {
    renderFr(<PriceTag amount={0} currency="EUR" loading />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
