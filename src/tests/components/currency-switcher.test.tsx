import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { CurrencySwitcher } from "@/components/atoms/currency-switcher";
import { CurrencyProvider } from "@/contexts/currency-context";
import type { Currency } from "@/lib/currency";
import frMessages from "@/i18n/messages/fr.json";

// Tests unitaires (Story 1.5) : le déclencheur du CurrencySwitcher est accessible
// et affiche la devise de travail active (code + symbole).
describe("CurrencySwitcher", () => {
  afterEach(() => {
    cleanup();
    document.cookie = "WORKING_CURRENCY=;path=/;max-age=0";
  });

  function renderWithCurrency(currency: Currency) {
    return render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <CurrencyProvider initialCurrency={currency}>
          <CurrencySwitcher />
        </CurrencyProvider>
      </NextIntlClientProvider>,
    );
  }

  it("rend un déclencheur nommé affichant EUR €", () => {
    renderWithCurrency("EUR");
    const trigger = screen.getByTestId("currency-switcher");
    // Le nom accessible annonce l'action ET la devise active (lecteur d'écran).
    expect(trigger.getAttribute("aria-label")).toContain(
      "Changer de devise de travail",
    );
    expect(trigger.getAttribute("aria-label")).toContain("EUR");
    expect(trigger).toHaveTextContent("EUR");
    expect(trigger).toHaveTextContent("€");
  });

  it("affiche USD $ quand la devise active est USD", () => {
    renderWithCurrency("USD");
    const trigger = screen.getByTestId("currency-switcher");
    expect(trigger).toHaveTextContent("USD");
    expect(trigger).toHaveTextContent("$");
  });
});
