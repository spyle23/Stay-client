import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { CurrencyProvider } from "@/contexts/currency-context";
import { useCurrency } from "@/hooks/use-currency";

// Tests d'intégration (Story 1.5) : le contexte devise segmente l'app en une seule
// devise, persiste le choix (cookie WORKING_CURRENCY) et met à jour ses
// consommateurs sans rechargement (AC2).
function CurrencyProbe() {
  const { currency, setCurrency } = useCurrency();
  return (
    <div>
      <span data-testid="active-currency">{currency}</span>
      <button data-testid="pick-usd" onClick={() => setCurrency("USD")}>
        USD
      </button>
      <button data-testid="pick-eur" onClick={() => setCurrency("EUR")}>
        EUR
      </button>
    </div>
  );
}

describe("CurrencyProvider / useCurrency", () => {
  afterEach(() => {
    cleanup();
    document.cookie = "WORKING_CURRENCY=;path=/;max-age=0";
  });

  it("expose la devise initiale et la met à jour + persiste le cookie", () => {
    render(
      <CurrencyProvider initialCurrency="EUR">
        <CurrencyProbe />
      </CurrencyProvider>,
    );

    expect(screen.getByTestId("active-currency")).toHaveTextContent("EUR");

    fireEvent.click(screen.getByTestId("pick-usd"));
    expect(screen.getByTestId("active-currency")).toHaveTextContent("USD");
    expect(document.cookie).toContain("WORKING_CURRENCY=USD");

    fireEvent.click(screen.getByTestId("pick-eur"));
    expect(screen.getByTestId("active-currency")).toHaveTextContent("EUR");
    expect(document.cookie).toContain("WORKING_CURRENCY=EUR");
  });

  it("lève une erreur si utilisé hors provider", () => {
    // Rendu isolé d'un consommateur sans provider → garde-fou explicite.
    function Orphan() {
      useCurrency();
      return null;
    }
    // Silence l'erreur console attendue de React.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/CurrencyProvider/);
    spy.mockRestore();
  });
});
