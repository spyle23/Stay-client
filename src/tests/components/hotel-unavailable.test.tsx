import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { HotelUnavailable } from "@/components/organisms/hotel-unavailable";
import enMessages from "@/i18n/messages/en.json";
import frMessages from "@/i18n/messages/fr.json";

/**
 * État dégradé de la fiche hôtel (PMS ou BFF injoignable) : un état d'erreur **avec une sortie**
 * (spyle23/hotelerie#148, AC-2), jamais une impasse.
 */
describe("HotelUnavailable", () => {
  afterEach(cleanup);

  it("annonce l'indisponibilité (role=alert) et propose une sortie vers l'accueil", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <HotelUnavailable />
      </NextIntlClientProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "hotel-degraded");
    expect(alert).toHaveTextContent(frMessages.hotel.errorTitle);
    expect(alert).toHaveTextContent(frMessages.hotel.errorBody);

    const exit = screen.getByRole("link", { name: frMessages.hotel.errorCta });
    expect(exit).toHaveAttribute("href", "/");
    expect(exit).toHaveAttribute("data-testid", "hotel-degraded-cta");
  });

  it("est traduit en anglais", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HotelUnavailable />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("link", { name: enMessages.hotel.errorCta }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      enMessages.hotel.errorTitle,
    );
  });
});
