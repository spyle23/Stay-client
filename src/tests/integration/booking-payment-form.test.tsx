import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import frMessages from "@/i18n/messages/fr.json";

const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";

/**
 * Story 3.1 — machine à états du Payment Element.
 *
 * Stripe.js est **remplacé par un double** : le vrai monterait une iframe vers js.stripe.com,
 * injoignable et non déterministe en test. Ce qui est vérifié ici est ce que le double ne peut pas
 * fausser : quel état l'écran affiche pour chaque issue de `confirmPayment`, et surtout ce qu'il
 * **ne dit pas** (AC-8 : jamais « confirmé », jamais d'e-mail, jamais de code).
 */

const confirmPayment = vi.fn();
const retrievePaymentIntent = vi.fn();

vi.mock("@stripe/react-stripe-js", () => ({
  // Le provider ne fait que rendre ses enfants : sa seule responsabilité réelle (fournir le
  // contexte) est simulée par les hooks ci-dessous.
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({ confirmPayment, retrievePaymentIntent }),
  useElements: () => ({}),
}));

// ⚠️ `loadStripe` doit exposer `retrievePaymentIntent` : depuis le correctif de Phase 3, la
// payabilité est sondée AVANT le montage d'`<Elements>`, donc via cette instance-là et non via le
// hook `useStripe`. Un double sans cette méthode ferait retomber la sonde dans son `catch`.
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve({ retrievePaymentIntent })),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const createPaymentIntent = vi.fn();
vi.mock("@/services/payment.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/payment.service")
  >("@/services/payment.service");
  return { ...actual, createPaymentIntent };
});

// Importé APRÈS les mocks : le composant capture `useStripe` au chargement du module.
const { BookingPaymentForm } =
  await import("@/components/organisms/booking-payment-form");

const intent = (overrides: Record<string, unknown> = {}) => ({
  clientSecret: "pi_123_secret_abc",
  publishableKey: "pk_test_key",
  paymentIntentId: "pi_123",
  amount: 16_800,
  currency: "EUR",
  captureMethod: "manual" as const,
  ...overrides,
});

function renderForm(ui?: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        {ui ?? (
          <BookingPaymentForm
            reservationId={RESERVATION_ID}
            expectedTotal={16_800}
            expectedCurrency="EUR"
          />
        )}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BookingPaymentForm", () => {
  beforeEach(() => {
    createPaymentIntent.mockResolvedValue(intent());
    retrievePaymentIntent.mockResolvedValue({
      paymentIntent: { status: "requires_payment_method" },
    });
    confirmPayment.mockResolvedValue({
      paymentIntent: { status: "requires_capture" },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("demande un intent au montage et affiche le formulaire", async () => {
    renderForm();

    await waitFor(() => {
      expect(screen.getByTestId("payment-form")).toBeInTheDocument();
    });
    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("stripe-payment-element")).toBeInTheDocument();
  });

  it("ne demande jamais deux intents pour la même réservation", async () => {
    const { rerender } = renderForm();
    await waitFor(() => expect(createPaymentIntent).toHaveBeenCalledTimes(1));

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="fr" messages={frMessages}>
          <BookingPaymentForm
            reservationId={RESERVATION_ID}
            expectedTotal={16_800}
            expectedCurrency="EUR"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    // Chaque demande engage le PMS et Stripe : un re-rendu ne doit pas en déclencher une seconde.
    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  describe("AC-1 / UX-DR-9.9 — promesse d'absence de débit ferme", () => {
    it("annonce que la carte est seulement autorisée en capture manuelle", async () => {
      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-no-firm-debit")).toBeInTheDocument(),
      );
    });

    it("CESSE de le promettre si le serveur rapporte une capture automatique", async () => {
      createPaymentIntent.mockResolvedValue(
        intent({ captureMethod: "automatic" }),
      );
      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );
      // Le texte disparaît au lieu de devenir faux : c'est tout l'intérêt de le faire porter par
      // le serveur plutôt que de l'écrire en dur.
      expect(
        screen.queryByTestId("payment-no-firm-debit"),
      ).not.toBeInTheDocument();
    });
  });

  describe("AC-3 — états du paiement", () => {
    it("passe en état autorisé quand Stripe renvoie requires_capture", async () => {
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      fireEvent.submit(screen.getByTestId("payment-form"));

      await waitFor(() =>
        expect(screen.getByTestId("payment-authorized")).toBeInTheDocument(),
      );
    });

    it("confirme sans quitter la page (redirect: if_required)", async () => {
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      fireEvent.submit(screen.getByTestId("payment-form"));

      await waitFor(() => expect(confirmPayment).toHaveBeenCalled());
      expect(confirmPayment).toHaveBeenCalledWith(
        expect.objectContaining({ redirect: "if_required" }),
      );
    });

    it("expose l'état 3-D Secure quand la banque demande une action", async () => {
      confirmPayment.mockResolvedValue({
        paymentIntent: { status: "requires_action" },
      });
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      fireEvent.submit(screen.getByTestId("payment-form"));

      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toHaveAttribute(
          "data-phase",
          "3ds",
        ),
      );
    });
  });

  describe("AC-4 — refus : la réservation survit et le rejeu est possible", () => {
    beforeEach(() => {
      confirmPayment.mockResolvedValue({
        error: { message: "Votre carte a été refusée." },
      });
    });

    it("affiche le motif de Stripe et propose de resoumettre le MÊME formulaire", async () => {
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      fireEvent.submit(screen.getByTestId("payment-form"));

      await waitFor(() =>
        expect(screen.getByTestId("payment-error")).toHaveTextContent(
          "Votre carte a été refusée.",
        ),
      );
      // Le formulaire reste monté et actif : ni retour au récapitulatif, ni recréation.
      expect(screen.getByTestId("payment-submit")).toBeEnabled();
      expect(screen.getByTestId("payment-retry-hint")).toBeInTheDocument();
      // Aucun second intent n'a été demandé.
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    });
  });

  describe("AC-6 / AC-8 — reprise après rechargement", () => {
    it("affiche l'état autorisé sans reproposer de payer un intent déjà autorisé", async () => {
      retrievePaymentIntent.mockResolvedValue({
        paymentIntent: { status: "requires_capture" },
      });
      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-authorized")).toBeInTheDocument(),
      );
      // Le chemin de double débit : proposer de payer une carte déjà retenue.
      expect(screen.queryByTestId("payment-submit")).not.toBeInTheDocument();
    });

    it("ne prétend JAMAIS que la réservation est confirmée", async () => {
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );
      fireEvent.submit(screen.getByTestId("payment-form"));

      const panel = await screen.findByTestId("payment-authorized");

      // AC-8. Le défaut de la story 2.3 (« confirmation envoyée » alors qu'elle ne l'était pas)
      // ne doit pas se rejouer ici sous une autre forme.
      expect(panel.textContent ?? "").not.toMatch(/confirmée|e-?mail|QR|PDF/i);
      expect(panel).toHaveTextContent("Paiement autorisé");
    });
  });

  describe("échec de la demande d'intent", () => {
    it("propose de réessayer sur une indisponibilité", async () => {
      const { ApiClientError } = await import("@/lib/api-client");
      createPaymentIntent.mockRejectedValue(new ApiClientError("…", 503));
      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-intent-error")).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId("payment-intent-error-action"),
      ).toBeInTheDocument();
    });

    it("bascule sur l'état autorisé plutôt que sur une erreur", async () => {
      const { ApiClientError } = await import("@/lib/api-client");
      createPaymentIntent.mockRejectedValue(
        new ApiClientError("…", 409, { reason: ["already-authorized"] }),
      );
      renderForm();

      // ⚠️ Ce test affirmait auparavant qu'un bandeau d'erreur SANS bouton « Réessayer » était le
      // bon rendu. Il verrouillait le défaut : « paiement déjà engagé » signifie que la carte porte
      // une retenue, donc que l'écran doit dire « autorisé », pas alerter.
      await waitFor(() =>
        expect(screen.getByTestId("payment-authorized")).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId("payment-intent-error"),
      ).not.toBeInTheDocument();
    });
  });

  describe("revue de code — rechargement après autorisation (webhook reçu)", () => {
    /**
     * Le constat le plus grave de la revue, trouvé par les trois couches indépendamment.
     *
     * Dès que le webhook Stripe pose `Authorized`, le PMS refuse un second intent et le BFF renvoie
     * 409 `already-authorized`. L'écran sortait alors en bandeau `role="alert"` — à un voyageur dont
     * la carte porte une retenue réelle, et sans aucune issue. La Phase 3 ne pouvait pas le voir :
     * les webhooks n'arrivent pas sur un poste de développement, si bien que le smoke validait le
     * chemin dégradé et non le chemin nominal de production.
     */
    it("affiche l'état AUTORISÉ, pas une erreur", async () => {
      const { ApiClientError } = await import("@/lib/api-client");
      createPaymentIntent.mockRejectedValue(
        new ApiClientError("…", 409, { reason: ["already-authorized"] }),
      );

      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-authorized")).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId("payment-intent-error"),
      ).not.toBeInTheDocument();
      // Et surtout : aucune invitation à payer une seconde fois.
      expect(screen.queryByTestId("payment-submit")).not.toBeInTheDocument();
    });

    it("n'annonce toujours pas une réservation confirmée (AC-8)", async () => {
      const { ApiClientError } = await import("@/lib/api-client");
      createPaymentIntent.mockRejectedValue(
        new ApiClientError("…", 409, { reason: ["already-authorized"] }),
      );

      renderForm();

      const panel = await screen.findByTestId("payment-authorized");
      expect(panel.textContent ?? "").not.toMatch(/confirmée|e-?mail|QR|PDF/i);
    });
  });

  describe("revue de code — C9 : jamais payer un montant non vérifiable", () => {
    it("refuse d'afficher le formulaire quand le montant diverge du devis", async () => {
      createPaymentIntent.mockResolvedValue(intent({ amount: 9_900 }));

      renderForm();

      await waitFor(() =>
        expect(
          screen.getByTestId("payment-amount-unverified"),
        ).toBeInTheDocument(),
      );
      // Le garde-fou ne se contentait que de changer le libellé : le bouton restait rendu.
      expect(screen.queryByTestId("payment-submit")).not.toBeInTheDocument();
    });

    it("refuse aussi quand l'exposant de la devise n'est pas fiable", async () => {
      createPaymentIntent.mockResolvedValue(intent({ currency: "ZZZ" }));

      renderForm();

      await waitFor(() =>
        expect(
          screen.getByTestId("payment-amount-unverified"),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("payment-submit")).not.toBeInTheDocument();
    });
  });

  describe("revue de code — la sonde ne devine plus", () => {
    it("rend la main au voyageur quand l'état du paiement est indéterminé", async () => {
      retrievePaymentIntent.mockRejectedValue(new Error("réseau instable"));

      renderForm();

      await waitFor(() =>
        expect(screen.getByTestId("payment-probe-failed")).toBeInTheDocument(),
      );
      // Monter le formulaire « au cas où » proposait de payer une carte peut-être déjà retenue.
      expect(screen.queryByTestId("payment-submit")).not.toBeInTheDocument();
    });
  });

  describe("AC-3 / AC-9 — l'état annoncé est le bon", () => {
    it("annonce « prêt » et non « préparation » sur un formulaire interactif", async () => {
      renderForm();

      const form = await screen.findByTestId("payment-form");

      // `ready` n'existait que dans le type : l'écran annonçait « Préparation du paiement » alors
      // que le Payment Element était monté et le bouton actif.
      expect(form).toHaveAttribute("data-phase", "ready");
      expect(
        form.querySelector('[aria-live="polite"]')?.textContent ?? "",
      ).toMatch(/prêt/i);
    });
  });

  describe("AC-9 — accessibilité", () => {
    it("annonce l'état courant en aria-live polite", async () => {
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      const status = screen
        .getByTestId("payment-form")
        .querySelector('[aria-live="polite"]');

      // `polite` et non `assertive` : interrompre le lecteur d'écran à chaque frappe serait hostile.
      expect(status).not.toBeNull();
      expect(status).toHaveAttribute("role", "status");
    });

    it("associe le message d'erreur au bouton de soumission", async () => {
      confirmPayment.mockResolvedValue({
        error: { message: "Carte expirée." },
      });
      renderForm();
      await waitFor(() =>
        expect(screen.getByTestId("payment-form")).toBeInTheDocument(),
      );

      fireEvent.submit(screen.getByTestId("payment-form"));

      const error = await screen.findByTestId("payment-error");
      const submit = screen.getByTestId("payment-submit");
      // Sans association, un lecteur d'écran annonce « Payer » sans jamais dire pourquoi ça a échoué.
      expect(submit.getAttribute("aria-describedby")).toContain(error.id);
    });
  });
});
