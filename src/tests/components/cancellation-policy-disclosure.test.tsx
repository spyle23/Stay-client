import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { CancellationPolicyDisclosure } from "@/components/molecules/cancellation-policy-disclosure";
import type { CancellationPolicyResult } from "@/services/booking.service";
import frMessages from "@/i18n/messages/fr.json";

function renderFr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const fallback: CancellationPolicyResult = {
  source: "fallback",
  refundable: null,
  freeUntil: null,
  terms: null,
};

describe("CancellationPolicyDisclosure", () => {
  afterEach(cleanup);

  it("rend le repli D2 sans erreur brute et sans champ vide", () => {
    renderFr(<CancellationPolicyDisclosure policy={fallback} />);
    const node = screen.getByTestId("cancellation-policy-fallback");
    expect(node).toBeInTheDocument();
    expect(node.getAttribute("data-dependency")).toBe("D2");
    expect(node.textContent).toContain("Politique d’annulation");
  });

  /**
   * Cœur de l'AC-4 : tant que D2 n'est pas livré, le PMS n'expose AUCUNE politique. Afficher
   * « annulation gratuite jusqu'au … » serait une promesse fausse (UX-DR-9.5). On vérifie donc
   * qu'aucune gratuité, échéance ou proportion de remboursement n'est fabriquée.
   */
  it("ne fabrique jamais de gratuité, d’échéance ni de pourcentage en repli", () => {
    renderFr(<CancellationPolicyDisclosure policy={fallback} />);
    const text =
      screen.getByTestId("cancellation-policy-fallback").textContent ?? "";
    expect(text).not.toMatch(/gratuit/i);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/jusqu’au\s+\d/i);
  });

  /**
   * Décision de revue 2.2 : le repli promettait que les conditions « vous seront communiquées avec
   * votre confirmation » et que « l'annulation restera possible depuis votre espace client » —
   * deux capacités non livrées (D2 absent, annulation en libre-service = story 4.5). Même standard
   * que celui qu'AC-6 vient d'appliquer aux badges « Annulation gratuite ».
   */
  it("ne promet aucune capacité non livrée (communication des conditions, annulation en libre-service)", () => {
    renderFr(<CancellationPolicyDisclosure policy={fallback} />);
    const text =
      screen.getByTestId("cancellation-policy-fallback").textContent ?? "";
    expect(text).not.toMatch(/seront communiquées/i);
    expect(text).not.toMatch(/espace client/i);
    expect(text).not.toMatch(/lien de gestion/i);
    expect(text).not.toMatch(/restera possible/i);
    // Ce qui reste doit être vrai en toutes circonstances.
    expect(text).toMatch(/fixées par l’établissement/i);
  });

  it("affiche la politique réelle de l’hôtel quand elle existe (bascule D2)", () => {
    renderFr(
      <CancellationPolicyDisclosure
        policy={{
          source: "hotel",
          refundable: true,
          freeUntil: "2999-07-03T18:00:00Z",
          terms: "Remboursement intégral jusqu’à J-2.",
        }}
      />,
    );
    const node = screen.getByTestId("cancellation-policy");
    expect(node.getAttribute("data-policy-source")).toBe("hotel");
    expect(node.textContent).toMatch(/gratuite jusqu’au/i);
    expect(
      screen.getByTestId("cancellation-policy-details"),
    ).toBeInTheDocument();
  });

  /**
   * Revue 2.2 : `freeUntil` est un **instant**, pas une date-only. Le rendre sans l'heure
   * laisserait croire que la journée entière est acquise — un contresens facturable pour le
   * voyageur qui annulerait le soir d'une échéance fixée à 18:00 UTC.
   */
  it("conserve l’heure de l’échéance d’annulation (jamais une date-only trompeuse)", () => {
    renderFr(
      <CancellationPolicyDisclosure
        policy={{
          source: "hotel",
          refundable: true,
          freeUntil: "2999-07-03T18:00:00Z",
          terms: null,
        }}
      />,
    );
    const text = screen.getByTestId("cancellation-policy").textContent ?? "";
    expect(text).toMatch(/18:00/);
    expect(text).toMatch(/UTC/);
  });

  /**
   * Revue 2.2 : `formatDate`/`Intl` **lèvent** sur une date non parsable. Une donnée amont
   * douteuse ne doit pas faire tomber l'écran qui précède le paiement — le composant retombe
   * sur l'énoncé de remboursabilité.
   */
  it("ne tombe pas sur une échéance non parsable et n’en affiche aucune", () => {
    renderFr(
      <CancellationPolicyDisclosure
        policy={{
          source: "hotel",
          refundable: true,
          freeUntil: "pas-une-date",
          terms: null,
        }}
      />,
    );
    const text = screen.getByTestId("cancellation-policy").textContent ?? "";
    expect(text).toMatch(/remboursable/i);
    expect(text).not.toMatch(/gratuite jusqu/i);
    expect(text).not.toMatch(/invalid/i);
  });

  it("n’affirme pas une gratuité quand l’hôtel ne donne qu’un caractère remboursable", () => {
    renderFr(
      <CancellationPolicyDisclosure
        policy={{
          source: "hotel",
          refundable: false,
          freeUntil: null,
          terms: null,
        }}
      />,
    );
    const node = screen.getByTestId("cancellation-policy");
    const text = node.textContent ?? "";
    expect(text).toMatch(/n’est pas remboursable/i);
    expect(text).not.toMatch(/gratuite jusqu/i);
    // Revue 2.2 : la contrainte la plus forte du parcours ne doit pas porter l'habillage
    // « succès » — la couleur ne peut pas contredire le texte juste au-dessus du CTA.
    expect(node.getAttribute("data-policy-tone")).toBe("restrictive");
    expect(node.className).not.toMatch(/success/);
  });
});
