import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { BookingIdentify } from "@/components/organisms/booking-identify";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import type { BookingQuoteResult } from "@/services/booking.service";
import enMessages from "@/i18n/messages/en.json";
import frMessages from "@/i18n/messages/fr.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  guests: 2,
  currency: "EUR",
};

const quote: BookingQuoteResult = {
  hotelId: HOTEL_ID,
  hotelName: "Hôtel Colline",
  hotelCity: "Antananarivo",
  hotelLogoUrl: null,
  roomId: ROOM_ID,
  roomNumber: "204",
  roomCategory: "Double Confort",
  roomCapacity: 2,
  roomImageUrl: null,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  nights: 2,
  guests: 2,
  currency: "EUR",
  pricePerNight: 8400,
  roomTotal: 16800,
  taxAmount: null,
  taxState: "included_undetailed",
  total: 16800,
  available: true,
  availabilityDegraded: false,
  cancellationPolicy: {
    source: "fallback",
    refundable: null,
    freeUntil: null,
    terms: null,
  },
  quotedAt: "2999-07-01T10:00:00Z",
};

const ANONYMOUS = { authenticated: false, user: null };
const SIGNED_IN = {
  authenticated: true,
  user: {
    userId: "u-1",
    email: "voyageur@example.com",
    firstName: "Rakoto",
    lastName: "Randria",
  },
};

const GUEST_INPUT = {
  firstName: "Hery",
  lastName: "Rakoto",
  email: "invite@example.com",
  phone: "+261340000000",
};

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

/**
 * Routeur de `fetch` par URL : le composant appelle **deux** endpoints du BFF (devis + session)
 * et le test doit pouvoir faire varier chacun indépendamment.
 */
function stubFetch(handlers: {
  quote?: () => unknown;
  session?: () => unknown;
  guest?: () => unknown;
  login?: () => unknown;
  logout?: () => unknown;
}) {
  const calls: string[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    calls.push(url);
    void init; // signature complète : les tests inspectent `mock.calls[i][1]`.
    if (url.includes("/booking/quote")) {
      return Promise.resolve(
        handlers.quote?.() ?? json({ success: true, data: quote }),
      );
    }
    if (url.includes("/auth/session")) {
      return Promise.resolve(
        handlers.session?.() ?? json({ success: true, data: ANONYMOUS }),
      );
    }
    if (url.includes("/auth/guest")) {
      return Promise.resolve(
        handlers.guest?.() ?? json({ success: true, data: SIGNED_IN }),
      );
    }
    if (url.includes("/auth/login")) {
      return Promise.resolve(
        handlers.login?.() ?? json({ success: true, data: SIGNED_IN }),
      );
    }
    if (url.includes("/auth/logout")) {
      return Promise.resolve(
        handlers.logout?.() ?? json({ success: true, data: ANONYMOUS }),
      );
    }
    throw new Error(`URL non mockée : ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderIdentify(overrides: Partial<ParsedBookingParams> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookingIdentify params={{ ...params, ...overrides }} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function fillGuestForm() {
  fireEvent.change(await screen.findByTestId("guest-first-name"), {
    target: { value: GUEST_INPUT.firstName },
  });
  fireEvent.change(screen.getByTestId("guest-last-name"), {
    target: { value: GUEST_INPUT.lastName },
  });
  fireEvent.change(screen.getByTestId("guest-email"), {
    target: { value: GUEST_INPUT.email },
  });
  fireEvent.change(screen.getByTestId("guest-phone"), {
    target: { value: GUEST_INPUT.phone },
  });
}

describe("BookingIdentify (intégration — story 2.3)", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("propose le mode invité par défaut, sans jamais forcer l’inscription", async () => {
    stubFetch({});
    renderIdentify();

    expect(await screen.findByTestId("guest-form")).toBeInTheDocument();
    expect(screen.getByTestId("identify-tab-guest")).toHaveAttribute(
      "data-active",
    );
    expect(screen.getByTestId("identify-tab-account")).not.toHaveAttribute(
      "data-active",
    );
  });

  it("affiche le récapitulatif persistant à l’étape d’identification (UX-DR-2.5)", async () => {
    stubFetch({});
    renderIdentify();

    expect(await screen.findByTestId("booking-summary")).toBeInTheDocument();
  });

  it("provisionne l’invité puis mène au paiement, sans transporter de mot de passe", async () => {
    const { fetchMock } = stubFetch({});
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining("/booking/payment"),
      ),
    );
    // Le contexte de séjour doit survivre au changement d'étape (UX-DR-4.4).
    const target = push.mock.calls[0][0] as string;
    expect(target).toContain(`hotelId=${HOTEL_ID}`);
    expect(target).toContain("checkInDate=2999-07-05");
    expect(target).toContain("guests=2");

    const guestCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes("/auth/guest"),
    );
    const body = (guestCall?.[1] as RequestInit).body as string;
    expect(JSON.parse(body)).toEqual(GUEST_INPUT);
    expect(body).not.toMatch(/password/i);
  });

  it("n’émet aucun appel tant que la saisie est invalide (validation i18n)", async () => {
    const { fetchMock } = stubFetch({});
    renderIdentify();
    await screen.findByTestId("guest-form");

    fireEvent.click(screen.getByTestId("guest-submit"));

    await waitFor(() =>
      expect(
        screen.getAllByText("Ce champ est requis.").length,
      ).toBeGreaterThan(0),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes("/auth/guest"),
      ),
    ).toBe(false);
  });

  it("collision d’email → bascule sur l’onglet compte avec l’email pré-rempli", async () => {
    stubFetch({
      guest: () => json({ success: false, message: "conflit" }, 409),
    });
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    expect(
      await screen.findByTestId("guest-email-conflict"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("login-email")).toHaveValue(GUEST_INPUT.email);
    expect(push).not.toHaveBeenCalled();
  });

  /**
   * Régression : `zodFieldValidator` ne consomme que le verdict de Zod, donc react-hook-form
   * conserve la saisie **brute**. Sans normalisation explicite, `values.email` en casse mixte ne
   * correspondait jamais à l'email de session (toujours minuscule côté PMS) — la reprise de
   * double soumission ne se déclenchait pas, et le voyageur, pourtant connecté, était renvoyé
   * vers une connexion impossible. Le test le plus proche utilisait un email déjà minuscule.
   */
  it("normalise l’email saisi en casse mixte avant de l’envoyer au BFF", async () => {
    const { fetchMock } = stubFetch({});
    renderIdentify();
    await fillGuestForm();
    fireEvent.change(screen.getByTestId("guest-email"), {
      target: { value: "  Invite@Example.COM  " },
    });

    fireEvent.click(screen.getByTestId("guest-submit"));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const guestCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes("/auth/guest"),
    );
    const body = JSON.parse((guestCall?.[1] as RequestInit).body as string) as {
      email: string;
    };
    expect(body.email).toBe("invite@example.com");
  });

  it("collision + email en CASSE MIXTE + session ouverte → poursuit quand même", async () => {
    let sessionReads = 0;
    stubFetch({
      guest: () => json({ success: false, message: "conflit" }, 409),
      session: () => {
        sessionReads += 1;
        return json({
          success: true,
          data:
            sessionReads === 1
              ? ANONYMOUS
              : {
                  ...SIGNED_IN,
                  user: { ...SIGNED_IN.user, email: GUEST_INPUT.email },
                },
        });
      },
    });
    renderIdentify();
    await fillGuestForm();
    fireEvent.change(screen.getByTestId("guest-email"), {
      target: { value: "Invite@Example.COM" },
    });

    fireEvent.click(screen.getByTestId("guest-submit"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining("/booking/payment"),
      ),
    );
    expect(
      screen.queryByTestId("guest-email-conflict"),
    ).not.toBeInTheDocument();
  });

  it("collision + session déjà ouverte sur cet email → poursuit (double soumission)", async () => {
    // La 1ʳᵉ requête a abouti et posé le cookie ; la 2ᵉ revient en 409. Accuser une collision
    // enverrait le voyageur se connecter à un compte dont personne n'a le mot de passe.
    let sessionReads = 0;
    stubFetch({
      guest: () => json({ success: false, message: "conflit" }, 409),
      session: () => {
        sessionReads += 1;
        return json({
          success: true,
          data:
            sessionReads === 1
              ? ANONYMOUS
              : {
                  ...SIGNED_IN,
                  user: { ...SIGNED_IN.user, email: GUEST_INPUT.email },
                },
        });
      },
    });
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining("/booking/payment"),
      ),
    );
    expect(
      screen.queryByTestId("guest-email-conflict"),
    ).not.toBeInTheDocument();
  });

  it("« utiliser une autre adresse » ramène au formulaire invité, email vidé", async () => {
    stubFetch({
      guest: () => json({ success: false, message: "conflit" }, 409),
    });
    renderIdentify();
    await fillGuestForm();
    fireEvent.click(screen.getByTestId("guest-submit"));
    await screen.findByTestId("guest-email-conflict");

    fireEvent.click(screen.getByTestId("guest-use-another-email"));

    expect(await screen.findByTestId("guest-form")).toBeInTheDocument();
    expect(screen.getByTestId("guest-email")).toHaveValue("");
  });

  it("panne du BFF → message i18n, jamais le texte technique", async () => {
    stubFetch({
      guest: () =>
        json({ success: false, message: "ECONNREFUSED upstream" }, 503),
    });
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    const error = await screen.findByTestId("guest-error");
    expect(error).toHaveTextContent(frMessages.auth.errorUnavailable);
    expect(error).not.toHaveTextContent("ECONNREFUSED");
    expect(push).not.toHaveBeenCalled();
  });

  /**
   * La moitié « compte » du parcours FR-8 : se connecter **dans le tunnel** ne doit pas naviguer,
   * mais recomposer l'écran sur le panneau connecté. Aucun test ne l'exécutait — seule la valeur
   * pré-remplie du champ email était vérifiée.
   */
  it("connexion depuis l’onglet compte : pas de navigation, l’écran passe au panneau connecté", async () => {
    let sessionReads = 0;
    const { fetchMock } = stubFetch({
      session: () => {
        sessionReads += 1;
        return json({
          success: true,
          data: sessionReads === 1 ? ANONYMOUS : SIGNED_IN,
        });
      },
      login: () => json({ success: true, data: SIGNED_IN }),
    });
    renderIdentify();
    await screen.findByTestId("guest-form");

    fireEvent.click(screen.getByTestId("identify-tab-account"));
    fireEvent.change(await screen.findByTestId("login-email"), {
      target: { value: "voyageur@example.com" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByTestId("login-submit"));

    expect(await screen.findByTestId("identify-signed-in")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-form")).not.toBeInTheDocument();
    // In situ : la connexion ne quitte pas l'étape (le récapitulatif persistant survivrait mal).
    expect(push).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes("/auth/login"),
      ),
    ).toBe(true);
  });

  it("voyageur connecté : identité pré-remplie, aucun formulaire invité", async () => {
    stubFetch({ session: () => json({ success: true, data: SIGNED_IN }) });
    renderIdentify();

    expect(await screen.findByTestId("identify-signed-in")).toBeInTheDocument();
    expect(screen.getByTestId("identify-identity")).toHaveTextContent(
      "Rakoto Randria",
    );
    expect(screen.getByTestId("identify-identity")).toHaveTextContent(
      "voyageur@example.com",
    );
    expect(screen.queryByTestId("guest-form")).not.toBeInTheDocument();
  });

  it("voyageur connecté : le CTA mène au paiement avec le contexte", async () => {
    stubFetch({ session: () => json({ success: true, data: SIGNED_IN }) });
    renderIdentify();

    fireEvent.click(await screen.findByTestId("identify-continue"));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/booking/payment"),
    );
  });

  it("dépassement de capacité : CTA neutralisé et porte de sortie", async () => {
    stubFetch({
      quote: () => json({ success: true, data: { ...quote, guests: 3 } }),
      session: () => json({ success: true, data: SIGNED_IN }),
    });
    renderIdentify({ guests: 3 });

    expect(await screen.findByTestId("identify-blocked")).toBeInTheDocument();
    expect(await screen.findByTestId("identify-continue")).toBeDisabled();
    expect(screen.getByTestId("identify-blocked-exit")).toBeInTheDocument();
  });

  it("chambre indisponible : soumission invité neutralisée", async () => {
    stubFetch({
      quote: () =>
        json({ success: true, data: { ...quote, available: false } }),
    });
    renderIdentify();

    expect(await screen.findByTestId("identify-blocked")).toBeInTheDocument();
    expect(await screen.findByTestId("guest-submit")).toBeDisabled();
  });

  it("disponibilité DÉGRADÉE : ne bloque pas (incertitude ≠ indisponibilité)", async () => {
    // Règle héritée de 1.10/2.2 : une panne du cross-check PMS ne doit jamais s'afficher
    // « indisponible » ni fermer le tunnel — la vérité est tranchée à la création (2.4).
    stubFetch({
      quote: () =>
        json({
          success: true,
          data: { ...quote, available: false, availabilityDegraded: true },
        }),
    });
    renderIdentify();

    await screen.findByTestId("guest-form");
    expect(screen.queryByTestId("identify-blocked")).not.toBeInTheDocument();
    expect(screen.getByTestId("guest-submit")).not.toBeDisabled();
  });

  /**
   * Défaut trouvé en Phase 3 : le libellé annonçait « Confirmation **envoyée** à … » alors
   * qu'aucune réservation n'existe encore (création = 2.4, email = FR-13/Epic 3). Même classe de
   * promesse non fondée que les badges « Annulation gratuite » retirés en 2.2 (AC-6).
   */
  it.each(["fr", "en"] as const)(
    "n’affirme jamais un envoi de confirmation déjà effectué (%s)",
    async (locale) => {
      const messages = locale === "fr" ? frMessages : enMessages;
      const notice = messages.booking.confirmationNotice;
      expect(notice).not.toMatch(/envoyée|\bsent\b/i);
      expect(notice).toMatch(/enverrons|will send/i);
    },
  );

  it("devis en erreur : l’écran l’explique, offre une sortie et NEUTRALISE la soumission", async () => {
    // Sans devis, `overCapacity`/`unavailable` valent `false` : laisser passer créerait un vrai
    // compte `Customer` puis enverrait payer une chambre dont on ignore tout.
    stubFetch({ quote: () => json({ success: false }, 500) });
    renderIdentify();

    expect(
      await screen.findByTestId("identify-quote-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("identify-quote-exit")).toBeInTheDocument();
    expect(await screen.findByTestId("guest-submit")).toBeDisabled();
    expect(
      screen.getByTestId("identify-summary-unavailable"),
    ).toBeInTheDocument();
  });

  it("devis refusé (4xx) : pas de « Réessayer » condamné, mais une porte de sortie", async () => {
    stubFetch({ quote: () => json({ success: false }, 400) });
    renderIdentify();

    expect(
      await screen.findByTestId("identify-quote-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("identify-quote-retry"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("identify-quote-exit")).toBeInTheDocument();
  });

  it("devis pas encore résolu : la soumission reste neutralisée", async () => {
    // Un devis en attente n'autorise rien : c'est un état inconnu, pas un séjour valide.
    stubFetch({ quote: () => new Promise(() => undefined) });
    renderIdentify();

    expect(await screen.findByTestId("guest-submit")).toBeDisabled();
  });

  /**
   * Une panne de lecture de session n'est pas un état anonyme. Proposer le formulaire invité à un
   * voyageur connecté le pousserait à créer un second compte — et le BFF détruirait sa session
   * réelle au passage, court-circuitant le bouton « changer de compte ».
   */
  it("panne de /auth/session : ni formulaire invité, ni panneau connecté — un état explicite", async () => {
    stubFetch({ session: () => json({ success: false }, 503) });
    renderIdentify();

    expect(
      await screen.findByTestId("identify-session-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("guest-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("identify-signed-in")).not.toBeInTheDocument();
    expect(screen.getByTestId("identify-session-retry")).toBeInTheDocument();
  });

  it("échec après création du compte : message dédié qui n’invite pas au rejeu", async () => {
    stubFetch({
      guest: () =>
        json(
          {
            success: false,
            message: "…",
            errors: { reason: ["guest-account-created"] },
          },
          503,
        ),
    });
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    const error = await screen.findByTestId("guest-error");
    expect(error).toHaveTextContent(frMessages.auth.guestErrorAccountCreated);
    // Surtout PAS le message de panne ordinaire, qui invite à réessayer sur la même adresse.
    expect(error).not.toHaveTextContent(frMessages.auth.errorUnavailable);
    expect(push).not.toHaveBeenCalled();
  });

  it("saisie refusée (400) : message de correction, jamais « Réessayez »", async () => {
    stubFetch({ guest: () => json({ success: false, message: "…" }, 400) });
    renderIdentify();
    await fillGuestForm();

    fireEvent.click(screen.getByTestId("guest-submit"));

    const error = await screen.findByTestId("guest-error");
    expect(error).toHaveTextContent(frMessages.auth.guestErrorRejected);
    expect(error).not.toHaveTextContent(frMessages.auth.guestErrorGeneric);
  });

  it("changer d’onglet à la main efface l’alerte de collision périmée", async () => {
    stubFetch({
      guest: () => json({ success: false, message: "conflit" }, 409),
    });
    renderIdentify();
    await fillGuestForm();
    fireEvent.click(screen.getByTestId("guest-submit"));
    await screen.findByTestId("guest-email-conflict");

    fireEvent.click(screen.getByTestId("identify-tab-guest"));
    fireEvent.click(screen.getByTestId("identify-tab-account"));

    expect(
      screen.queryByTestId("guest-email-conflict"),
    ).not.toBeInTheDocument();
  });

  it("rappelle l’adresse saisie au niveau du CTA (AC-4)", async () => {
    stubFetch({});
    renderIdentify();
    await screen.findByTestId("guest-form");

    expect(
      screen.queryByTestId("guest-confirmation-recap"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("guest-email"), {
      target: { value: "Relu@Example.com" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("guest-confirmation-recap")).toHaveTextContent(
        "relu@example.com",
      ),
    );
  });

  it("compte sans nom : l’identité retombe sur l’email, jamais une phrase amputée", async () => {
    stubFetch({
      session: () =>
        json({
          success: true,
          data: {
            authenticated: true,
            user: { ...SIGNED_IN.user, firstName: null, lastName: null },
          },
        }),
    });
    renderIdentify();

    const identity = await screen.findByTestId("identify-identity");
    expect(identity).toHaveTextContent("voyageur@example.com");
    expect(identity.textContent).not.toMatch(/\s{2}|de\s+\(/);
  });

  it("l’aide sur l’email ne promet plus de lien de gestion (hors périmètre 2.3)", () => {
    for (const messages of [frMessages, enMessages]) {
      expect(messages.booking.guestEmailHelp).not.toMatch(
        /lien de gestion|management link/i,
      );
    }
  });

  it("l’aide sur l’email est associée au champ (AC-4, a11y)", async () => {
    stubFetch({});
    renderIdentify();

    const email = await screen.findByTestId("guest-email");
    const help = screen.getByTestId("guest-email-help");
    expect(email.getAttribute("aria-describedby")).toContain(help.id);
    expect(help).toHaveTextContent(/confirmation/i);
  });
});
