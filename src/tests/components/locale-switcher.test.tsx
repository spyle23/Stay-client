import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { LocaleSwitcher } from "@/components/atoms/locale-switcher";
import frMessages from "@/i18n/messages/fr.json";

// `router.refresh()` (next/navigation) exige le contexte App Router, absent en
// test isolé → mock. Le comportement réel (retraduction + lang) est couvert en e2e.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Tests unitaires (Story 1.5) : le déclencheur du LocaleSwitcher est accessible
// et reflète la locale active. L'ouverture du menu (Base UI) est testée en e2e.
describe("LocaleSwitcher", () => {
  afterEach(cleanup);

  function renderWithLocale(locale: string) {
    return render(
      <NextIntlClientProvider locale={locale} messages={frMessages}>
        <LocaleSwitcher />
      </NextIntlClientProvider>,
    );
  }

  it("rend un déclencheur nommé et taggé, reflétant la locale active", () => {
    renderWithLocale("fr");
    const trigger = screen.getByTestId("locale-switcher");
    // Le nom accessible annonce l'action ET la langue active (lecteur d'écran).
    expect(trigger.getAttribute("aria-label")).toContain("Changer de langue");
    expect(trigger.getAttribute("aria-label")).toContain("Français");
    expect(trigger).toHaveTextContent("FR");
  });

  it("affiche la locale courante en anglais", () => {
    renderWithLocale("en");
    expect(screen.getByTestId("locale-switcher")).toHaveTextContent("EN");
  });
});
