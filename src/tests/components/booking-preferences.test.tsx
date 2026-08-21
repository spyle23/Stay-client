import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { BookingPreferences } from "@/components/molecules/booking-preferences";
import frMessages from "@/i18n/messages/fr.json";
import {
  SPECIAL_REQUESTS_MAX_LENGTH,
  type BookingPreferences as Preferences,
  type BookingPreferencesError,
} from "@/lib/validations/booking";

const base: Preferences = {
  specialRequests: "",
  communicationLocale: "fr",
  localeTouched: true,
};

function renderFr(
  value: Preferences = base,
  overrides: Partial<{
    onChange: (next: Preferences) => void;
    disabled: boolean;
    error: BookingPreferencesError | null;
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <BookingPreferences
        value={value}
        onChange={onChange}
        disabled={overrides.disabled ?? false}
        error={overrides.error ?? null}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onChange };
}

afterEach(cleanup);

describe("BookingPreferences", () => {
  it("présente les deux champs comme facultatifs", () => {
    renderFr();
    expect(screen.getByTestId("booking-preferences")).toBeInTheDocument();
    expect(screen.getByTestId("special-requests-input")).toBeInTheDocument();
    expect(
      screen.getByTestId("communication-locale-select"),
    ).toBeInTheDocument();
    // « Facultatif » doit être VISIBLE : un champ sans mention se lit comme obligatoire.
    expect(screen.getByText(/facultatif/i)).toBeInTheDocument();
  });

  it("associe le libellé au champ de texte (clic sur le label = focus)", () => {
    renderFr();
    const textarea = screen.getByLabelText(
      frMessages.booking.specialRequestsLabel,
    );
    expect(textarea).toBe(screen.getByTestId("special-requests-input"));
  });

  it("associe le libellé au sélecteur de langue", () => {
    renderFr();
    expect(
      screen.getByLabelText(frMessages.booking.communicationLocaleLabel),
    ).toBe(screen.getByTestId("communication-locale-select"));
  });

  it("remonte la saisie au parent (composant contrôlé)", () => {
    const onChange = vi.fn();
    renderFr(base, { onChange });
    fireEvent.change(screen.getByTestId("special-requests-input"), {
      target: { value: "Arrivée tardive" },
    });
    expect(onChange).toHaveBeenCalledWith({
      specialRequests: "Arrivée tardive",
      communicationLocale: "fr",
      localeTouched: true,
    });
  });

  it("remonte le changement de langue au parent", () => {
    const onChange = vi.fn();
    renderFr(base, { onChange });
    fireEvent.change(screen.getByTestId("communication-locale-select"), {
      target: { value: "en" },
    });
    expect(onChange).toHaveBeenCalledWith({
      specialRequests: "",
      communicationLocale: "en",
      localeTouched: true,
    });
  });

  it("n'offre que les langues que le PMS sait rendre", () => {
    // fr/en : intersection des locales du front et des `SupportedLanguages` du moteur d'emails.
    // Proposer autre chose promettrait une langue qui retomberait en silence sur « fr ».
    renderFr();
    const options = Array.from(
      screen
        .getByTestId("communication-locale-select")
        .querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    expect(options).toEqual(["fr", "en"]);
  });

  it("reflète la langue courante sans jamais la deviner autrement", () => {
    renderFr({ ...base, communicationLocale: "en" });
    expect(screen.getByTestId("communication-locale-select")).toHaveValue("en");
  });

  it("compte comme le BFF — normalisation complète, pas un simple `trim`", () => {
    // Un caractère invisible devient une ESPACE (jamais un retrait sec, qui collerait les mots) :
    // « a<U+00AD>bc » vaut donc 4, exactement comme le mesurera le BFF.
    renderFr({ ...base, specialRequests: "  a­bc  " });
    expect(screen.getByTestId("special-requests-counter")).toHaveTextContent(
      `4 / ${SPECIAL_REQUESTS_MAX_LENGTH}`,
    );
  });

  /**
   * Revue 2ᵉ passe (F5) — le front ne doit JAMAIS être plus strict que le BFF.
   *
   * Il mesurait `trim().length`, qui ne retire pas les invisibles de bord : un texte collé depuis
   * un PDF affichait « 1002 / 1000 », passait au rouge et était refusé localement, alors que le
   * BFF les aurait rognés et accepté 1000.
   */
  it("n'affiche aucun dépassement sur un texte que le BFF accepterait", () => {
    renderFr({ ...base, specialRequests: "­­" + "a".repeat(1000) });
    expect(screen.getByTestId("special-requests-counter")).toHaveTextContent(
      `1000 / ${SPECIAL_REQUESTS_MAX_LENGTH}`,
    );
    expect(
      screen.queryByTestId("special-requests-error"),
    ).not.toBeInTheDocument();
  });

  it("relie l'aide ET le compteur au champ par aria-describedby", () => {
    renderFr();
    const textarea = screen.getByTestId("special-requests-input");
    const described = (textarea.getAttribute("aria-describedby") ?? "").split(
      " ",
    );
    expect(described).toContain(
      screen.getByTestId("special-requests-counter").id,
    );
    expect(described.length).toBeGreaterThanOrEqual(2);
  });

  it("ne place PAS le compteur dans une région aria-live", () => {
    // L'annoncer à chaque frappe rendrait le champ inutilisable au lecteur d'écran (UX-DR-5.7).
    renderFr({ ...base, specialRequests: "abc" });
    const counter = screen.getByTestId("special-requests-counter");
    expect(counter).not.toHaveAttribute("aria-live");
    expect(counter.closest("[aria-live]")).toBeNull();
  });

  it("marque le champ invalide au-delà de la borne", () => {
    renderFr({ ...base, specialRequests: "a".repeat(1001) });
    expect(screen.getByTestId("special-requests-input")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  /**
   * Revue 2.5 — `aria-invalid` ne doit **jamais** exister sans sa cause.
   *
   * Le champ était marqué invalide dès le dépassement, mais le message n'apparaissait qu'à la
   * soumission : le lecteur d'écran annonçait « invalide » sans rien pour l'expliquer, et le seul
   * signal visuel entre-temps était le compteur passant au rouge — la **seule couleur** (UX-DR-5.3).
   */
  it("affiche la cause dès le dépassement, sans attendre la soumission", () => {
    // `error` volontairement absent : c'est le cas « en cours de frappe ».
    renderFr({ ...base, specialRequests: "a".repeat(1001) });

    const error = screen.getByTestId("special-requests-error");
    expect(error).toHaveTextContent(String(SPECIAL_REQUESTS_MAX_LENGTH));
    expect(
      screen
        .getByTestId("special-requests-input")
        .getAttribute("aria-describedby"),
    ).toContain(error.id);
  });

  it("n'affiche aucune erreur tant que la borne est respectée", () => {
    renderFr({ ...base, specialRequests: "a".repeat(1000) });
    expect(
      screen.queryByTestId("special-requests-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("special-requests-input")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  /**
   * Revue 2ᵉ passe (F15) — l'ancienne version n'exécutait d'assertion que dans **1 itération sur
   * 3** : les deux cas sous la borne ne posent pas `aria-invalid`, et le `if` les rendait
   * silencieux. Un test dont deux tiers des cas ne vérifient rien donne une assurance de façade.
   *
   * Chaque cas énonce désormais l'état attendu **des deux côtés** de l'invariant.
   */
  it.each([
    ["vide", "", false],
    ["sur la borne", "a".repeat(1000), false],
    ["au-delà de la borne", "a".repeat(1001), true],
  ])(
    "invalidité et cause vont toujours ensemble — %s",
    (_label, specialRequests, attenduInvalide) => {
      renderFr({ ...base, specialRequests });
      const field = screen.getByTestId("special-requests-input");
      const error = screen.queryByTestId("special-requests-error");

      expect(field.getAttribute("aria-invalid") === "true").toBe(
        attenduInvalide,
      );
      // L'invariant dans les DEUX sens : invalide ⇒ cause reliée ; valide ⇒ aucune cause.
      expect(error !== null).toBe(attenduInvalide);
      if (error !== null) {
        expect(field.getAttribute("aria-describedby")).toContain(error.id);
      }
    },
  );

  it("affiche l'erreur, l'annonce, et la relie au champ", () => {
    renderFr(
      { ...base, specialRequests: "a".repeat(1001) },
      { error: "specialRequestsTooLong" },
    );
    const error = screen.getByTestId("special-requests-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(String(SPECIAL_REQUESTS_MAX_LENGTH));
    expect(
      screen
        .getByTestId("special-requests-input")
        .getAttribute("aria-describedby"),
    ).toContain(error.id);
  });

  /**
   * Revue 2ᵉ passe (F2) — l'ancien test verrouillait la formulation **fautive**.
   *
   * Le texte disait « lorsque l'hôtel prend en charge cette langue ». Or le sélecteur ne propose
   * que `fr` et `en`, et le moteur d'emails du PMS supporte exactement `fr` et `en` : la condition
   * était **toujours vraie**. Le voyageur lisait une promesse ferme déguisée en condition, et la
   * cause réelle — aucun chemin ne relie son choix au mailer (D10) — n'était jamais dite.
   */
  it("dit que la langue choisie ne pilote PAS encore les communications", () => {
    renderFr({ ...base, communicationLocale: "en" });
    const fallback = screen.getByTestId("communication-locale-fallback");
    expect(fallback).toHaveAttribute("data-dependency", "D10");

    const texte = fallback.textContent ?? "";
    // L'état de fait, énoncé au présent et sans condition échappatoire.
    expect(texte).toMatch(/ne pilote pas encore/i);
    // Aucune promesse ferme, ni conditionnelle sur une condition toujours satisfaite.
    expect(texte).not.toMatch(/vous recevrez/i);
    expect(texte).not.toMatch(/lorsque l’hôtel prend en charge cette langue/i);
  });

  it("neutralise les deux champs pendant la soumission", () => {
    renderFr(base, { disabled: true });
    expect(screen.getByTestId("special-requests-input")).toBeDisabled();
    expect(screen.getByTestId("communication-locale-select")).toBeDisabled();
  });

  /**
   * Revue 2ᵉ passe (F15) — l'ancienne version cherchait la **chaîne de classe**
   * `min-h-(--tap-min)`. jsdom n'applique aucun CSS : le test passait donc même si le jeton valait
   * 32 px, c'est-à-dire précisément la régression que son commentaire disait prévenir.
   *
   * La taille réelle ne peut se mesurer qu'en navigateur — c'est le rôle du balayage e2e
   * (`booking-payment.spec.ts`, « cibles tactiles ≥ 44 px »), qui mesure `boundingBox()` sur tous
   * les interactifs rendus. Ce test-ci se limite donc à ce que jsdom peut **réellement** prouver :
   * que le sélecteur est branché sur le jeton partagé, et pas sur une valeur en dur.
   */
  it("dimensionne le sélecteur par le jeton de cible tactile, jamais en dur", () => {
    renderFr();
    const classes = screen.getByTestId("communication-locale-select").className;
    expect(classes).toContain("min-h-(--tap-min)");
    // Aucune hauteur littérale ne doit court-circuiter le jeton (`min-h-8`, `min-h-[32px]`…).
    expect(classes).not.toMatch(/min-h-(?!\(--tap-min\))/);
  });
});
