import { StrictMode, type ReactElement } from "react";
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

import { BookingConfirmation } from "@/components/organisms/booking-confirmation";
import enMessages from "@/i18n/messages/en.json";
import frMessages from "@/i18n/messages/fr.json";
import type { ParsedBookingParams } from "@/lib/validations/booking";

const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const CONFIRM_URL = `/payment/reservations/${RESERVATION_ID}/confirm`;
const QR_URL = `/booking/reservations/${RESERVATION_ID}/confirmation-qr`;
const PDF_URL = `/booking/reservations/${RESERVATION_ID}/confirmation-pdf`;

const CONTEXT: ParsedBookingParams = {
  hotelId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  roomId: "22222222-2222-4222-8222-222222222222",
  checkInDate: "2099-09-01",
  checkOutDate: "2099-09-03",
  guests: 2,
  currency: "EUR",
};

function proof(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: RESERVATION_ID,
    reservationCode: "RES-20990901-A1B2C",
    status: "Confirmed",
    hotelName: "Hôtel Colline",
    roomNumber: "204",
    roomCategory: "Double Confort",
    checkInDate: "2099-09-01",
    checkOutDate: "2099-09-03",
    nights: 2,
    guests: 2,
    currency: "EUR",
    total: 18_300,
    roomTotal: 16_800,
    servicesTotal: 1_500,
    services: [],
    capturedAmount: 18_300,
    communicationLocale: "en",
    communicationLocaleState: "hotel_default_fallback",
    alreadyConfirmed: false,
    ...overrides,
  };
}

interface Reply {
  status: number;
  body?: unknown;
  blob?: Blob;
}

/** Faux BFF : une file de réponses par chemin, toutes les requêtes consignées. */
function installBff(routes: Record<string, Reply[]>): {
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = [...queues.keys()].find((path) => url.endsWith(path));
    const queue = key ? queues.get(key)! : [];
    const reply = (queue.length > 1 ? queue.shift() : queue[0]) ?? {
      status: 404,
    };
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(
        reply.blob ? { "Content-Type": reply.blob.type } : {},
      ),
      json: () => Promise.resolve(reply.body),
      blob: () => Promise.resolve(reply.blob ?? new Blob()),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { calls };
}

const ok = (data: unknown): Reply => ({
  status: 200,
  body: { success: true, data },
});
const fail = (status: number, reason?: string): Reply => ({
  status,
  body: {
    success: false,
    message: "Texte technique du BFF",
    ...(reason ? { errors: { reason: [reason] } } : {}),
  },
});
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
  type: "image/png",
});
const PDF = new Blob(["%PDF-1.7"], { type: "application/pdf" });

function renderConfirmation(
  options: {
    strict?: boolean;
    context?: ParsedBookingParams | null;
    locale?: "fr" | "en";
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const locale = options.locale ?? "fr";
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "fr" ? frMessages : enMessages}
      >
        <BookingConfirmation
          reservationId={RESERVATION_ID}
          context={options.context === undefined ? CONTEXT : options.context}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const confirmCalls = (calls: { url: string; init?: RequestInit }[]) =>
  calls.filter((c) => c.url.endsWith(CONFIRM_URL));

/**
 * Story 3.2 (C7/C8/C12) — écran de confirmation, BFF simulé au niveau de `fetch`.
 */
describe("BookingConfirmation", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let n = 0;
    createObjectURL = vi.fn(() => `blob:test/${++n}`);
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("AC-10 — une seule confirmation par montage", () => {
    it("sous StrictMode, la confirmation part UNE fois et la preuve s'affiche", async () => {
      const { calls } = installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });

      renderConfirmation({ strict: true });

      expect(await screen.findByTestId("confirmation-proof")).toBeVisible();
      expect(confirmCalls(calls)).toHaveLength(1);
      expect(confirmCalls(calls)[0].init).toMatchObject({
        method: "POST",
        credentials: "include",
      });
    });

    it("affiche l'état « confirmation en cours » tant que le BFF n'a pas répondu", async () => {
      global.fetch = vi.fn(
        () => new Promise<Response>(() => {}),
      ) as unknown as typeof fetch;

      renderConfirmation();

      const pending = await screen.findByTestId("confirmation-pending");
      expect(pending).toHaveAttribute("aria-busy", "true");
      expect(pending).toHaveTextContent(/Confirmation de votre réservation/);
    });
  });

  describe("AC-7 — ConfirmationProof", () => {
    beforeEach(() => {
      installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
        [PDF_URL]: [{ status: 200, blob: PDF }],
      });
    });

    it("badge texte + icône, code sélectionnable, récapitulatif et total payé", async () => {
      renderConfirmation();

      const badge = await screen.findByTestId("confirmation-badge");
      expect(badge).toHaveTextContent("Confirmée");
      expect(badge.querySelector("svg")).not.toBeNull();

      const code = screen.getByTestId("confirmation-code");
      expect(code.tagName).toBe("OUTPUT");
      expect(code).toHaveTextContent("RES-20990901-A1B2C");
      expect(code.className).toContain("select-all");

      const proofSection = screen.getByTestId("confirmation-proof");
      expect(proofSection).toHaveTextContent("Hôtel Colline");
      expect(proofSection).toHaveTextContent("Double Confort · n° 204");
      expect(proofSection).toHaveTextContent("2 nuits");
      expect(proofSection).toHaveTextContent("2 voyageurs");
      expect(screen.getByTestId("confirmation-total").textContent).toMatch(
        /183\s€/,
      );
    });

    it("le total affiché est le montant CAPTURÉ quand il est relu", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof({ capturedAmount: 16_800, total: 18_300 }))],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      expect(
        (await screen.findByTestId("confirmation-total")).textContent,
      ).toMatch(/168\s€/);
    });

    it("chemin idempotent (capturé non relu) : le total relu du serveur", async () => {
      installBff({
        [CONFIRM_URL]: [
          ok(proof({ capturedAmount: null, alreadyConfirmed: true })),
        ],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      expect(
        (await screen.findByTestId("confirmation-total")).textContent,
      ).toMatch(/183\s€/);
    });

    it("QR chargé par fetch + URL objet, avec une alternative qui décrit son usage", async () => {
      const { calls } = installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      const image = await screen.findByTestId("confirmation-qr-image");
      await waitFor(() => expect(image).toHaveAttribute("src", "blob:test/1"));
      expect(image.getAttribute("alt")).toMatch(/réception/);
      expect(image.getAttribute("alt")).not.toMatch(/^QR/i);
      const qrCall = calls.find((c) => c.url.endsWith(QR_URL));
      expect(qrCall?.init).toMatchObject({ credentials: "include" });
    });

    it("révoque l'URL objet du QR au démontage", async () => {
      const { unmount } = renderConfirmation();
      const image = await screen.findByTestId("confirmation-qr-image");
      await waitFor(() => expect(image).toHaveAttribute("src", "blob:test/1"));

      unmount();

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
    });

    it("PDF à la demande : rien au montage, puis génération annoncée et téléchargement", async () => {
      const { calls } = installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
        [PDF_URL]: [{ status: 200, blob: PDF }],
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      renderConfirmation();

      const button = await screen.findByTestId("confirmation-pdf");
      expect(calls.some((c) => c.url.endsWith(PDF_URL))).toBe(false);

      fireEvent.click(button);

      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(calls.filter((c) => c.url.endsWith(PDF_URL))).toHaveLength(1);
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("RES-20990901-A1B2C.pdf");
      expect(screen.getByTestId("confirmation-pdf-status")).toHaveTextContent(
        /téléchargement a démarré/,
      );
    });

    it("PDF en échec : message d'erreur annoncé, nouvel essai possible", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
        [PDF_URL]: [fail(503)],
      });
      renderConfirmation();

      fireEvent.click(await screen.findByTestId("confirmation-pdf"));

      await waitFor(() =>
        expect(screen.getByTestId("confirmation-pdf-status")).toHaveTextContent(
          /n'a pas pu être généré/,
        ),
      );
      expect(screen.getByTestId("confirmation-pdf")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });

    it("CTA « mes réservations » vers /account (route existante)", async () => {
      renderConfirmation();

      const cta = await screen.findByTestId("confirmation-account-cta");
      expect(cta).toHaveAttribute("href", "/account");
      expect(cta).toHaveTextContent("Mes réservations");
    });
  });

  describe("AC-9 — e-mail et langue (D10 non livrée)", () => {
    it("annonce un e-mail « en route », jamais « reçu », et ne promet pas la langue choisie", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      const email = await screen.findByTestId("confirmation-email");
      expect(email).toHaveTextContent(/en route/);
      expect(email.textContent).not.toMatch(/reçu|envoyé dans votre langue/i);
      expect(
        screen.getByTestId("confirmation-email-language-fallback"),
      ).toHaveTextContent(/English.*langue/);
    });

    it("sans langue choisie, aucune mention de langue", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof({ communicationLocale: null }))],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      await screen.findByTestId("confirmation-email");
      expect(
        screen.queryByTestId("confirmation-email-language-fallback"),
      ).not.toBeInTheDocument();
    });
  });

  describe("AC-11 — annonce et focus", () => {
    it("le titre reçoit le focus et l'arrivée est annoncée en aria-live polite", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      const title = await screen.findByTestId("confirmation-title");
      await waitFor(() => expect(title).toHaveFocus());
      const live = screen
        .getAllByRole("status")
        .find((node) => node.textContent?.includes("est confirmée"));
      expect(live).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("AC-6 — échecs sans cul-de-sac", () => {
    it("capture-failed : « Réessayer » relance la confirmation", async () => {
      const { calls } = installBff({
        [CONFIRM_URL]: [fail(502, "capture-failed"), ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      const panel = await screen.findByTestId("confirmation-failed");
      expect(panel).toHaveAttribute("role", "alert");
      expect(screen.getByTestId("confirmation-no-debit")).toHaveTextContent(
        /Aucun débit n'a été conservé/,
      );

      fireEvent.click(screen.getByTestId("confirmation-retry"));

      expect(await screen.findByTestId("confirmation-proof")).toBeVisible();
      expect(confirmCalls(calls)).toHaveLength(2);
    });

    it("unavailable : un essai automatique, puis « Réessayer » rendu au voyageur", async () => {
      const { calls } = installBff({
        [CONFIRM_URL]: [fail(503), fail(503), ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation();

      const panel = await screen.findByTestId(
        "confirmation-failed",
        {},
        { timeout: 4_000 },
      );
      expect(panel).toHaveAttribute("data-reason", "unavailable");
      expect(confirmCalls(calls)).toHaveLength(2);

      fireEvent.click(screen.getByTestId("confirmation-retry"));

      expect(await screen.findByTestId("confirmation-proof")).toBeVisible();
      expect(confirmCalls(calls)).toHaveLength(3);
    });

    it.each([
      "payment-not-authorized",
      "amount-mismatch",
      "authorisation-expired",
      "reservation-cancelled",
      "reservation-not-found",
      "not-owner",
      "rejected",
    ])(
      "%s : aucun « Réessayer », mais une sortie (récapitulatif et accueil)",
      async (reason) => {
        installBff({ [CONFIRM_URL]: [fail(409, reason)] });
        renderConfirmation();

        const panel = await screen.findByTestId("confirmation-failed");
        expect(panel).toHaveAttribute("data-reason", reason);
        expect(screen.queryByTestId("confirmation-retry")).toBeNull();
        expect(screen.getByTestId("confirmation-recap")).toHaveAttribute(
          "href",
          expect.stringContaining("/booking/recap?"),
        );
        expect(screen.getByTestId("confirmation-home")).toHaveAttribute(
          "href",
          "/",
        );
        expect(screen.getByTestId("confirmation-no-debit")).toBeVisible();
        // Le texte technique du BFF n'est jamais affiché.
        expect(panel.textContent).not.toContain("Texte technique");
      },
    );

    it("sans contexte de séjour, la sortie reste l'accueil", async () => {
      installBff({ [CONFIRM_URL]: [fail(409, "authorisation-expired")] });
      renderConfirmation({ context: null });

      await screen.findByTestId("confirmation-failed");
      expect(screen.queryByTestId("confirmation-recap")).toBeNull();
      expect(screen.getByTestId("confirmation-home")).toBeVisible();
    });

    it("session expirée : se reconnecter, puis revenir sur cette confirmation", async () => {
      installBff({ [CONFIRM_URL]: [fail(401)] });
      renderConfirmation();

      const login = await screen.findByTestId("confirmation-login");
      const next = new URL(
        login.getAttribute("href")!,
        "http://localhost",
      ).searchParams.get("next");
      expect(next).toContain(
        `/booking/confirmation?reservationId=${RESERVATION_ID}`,
      );
    });

    it("le focus va au titre de l'échec", async () => {
      installBff({ [CONFIRM_URL]: [fail(409, "amount-mismatch")] });
      renderConfirmation();

      const panel = await screen.findByTestId("confirmation-failed");
      const heading = panel.querySelector("h1");
      await waitFor(() => expect(heading).toHaveFocus());
    });
  });

  /**
   * #4 (story 3.3) AC-7 / AC-8 — chambre devenue indisponible avant la capture : statut de débit
   * énoncé d'après le BFF, et une issue vers les chambres disponibles de l'hôtel pour le même séjour.
   */
  describe("#4 — chambre indisponible et statut de débit", () => {
    const failWith = (
      status: number,
      errors: Record<string, string[]>,
    ): Reply => ({
      status,
      body: { success: false, message: "Texte technique du BFF", errors },
    });

    it("room-unavailable : « aucun débit », CTA vers les chambres de l’hôtel, mêmes dates et voyageurs", async () => {
      installBff({
        [CONFIRM_URL]: [
          failWith(409, { reason: ["room-unavailable"], debit: ["none"] }),
        ],
      });
      renderConfirmation();

      const panel = await screen.findByTestId("confirmation-failed");
      expect(panel).toHaveAttribute("data-reason", "room-unavailable");
      expect(panel).toHaveTextContent("Chambre plus disponible");
      expect(screen.getByTestId("confirmation-no-debit")).toHaveTextContent(
        /Aucun débit n'a été conservé/,
      );
      expect(screen.queryByTestId("confirmation-retry")).toBeNull();
      // Le récapitulatif ramènerait sur la chambre prise : l'issue est l'hôtel, pas la même chambre.
      expect(screen.queryByTestId("confirmation-recap")).toBeNull();

      const cta = screen.getByTestId("confirmation-alternatives");
      const href = new URL(cta.getAttribute("href")!, "http://localhost");
      expect(href.pathname).toBe(`/hotels/${CONTEXT.hotelId}`);
      expect(href.searchParams.get("checkInDate")).toBe(CONTEXT.checkInDate);
      expect(href.searchParams.get("checkOutDate")).toBe(CONTEXT.checkOutDate);
      expect(href.searchParams.get("guests")).toBe("2");
      expect(href.searchParams.get("currency")).toBe("EUR");
      expect(screen.getByTestId("confirmation-home")).toHaveAttribute(
        "href",
        "/",
      );
      expect(panel.textContent).not.toContain("Texte technique");
    });

    it("AC-5 : remboursement émis → « remboursement intégral émis », jamais « aucun débit »", async () => {
      installBff({
        [CONFIRM_URL]: [
          failWith(409, { reason: ["room-unavailable"], debit: ["refunded"] }),
        ],
      });
      renderConfirmation();

      const debit = await screen.findByTestId("confirmation-debit-refunded");
      expect(debit).toHaveTextContent(/Remboursement intégral émis/);
      expect(screen.queryByTestId("confirmation-no-debit")).toBeNull();
      expect(screen.getByTestId("confirmation-failed").textContent).not.toMatch(
        /Aucun débit/,
      );
    });

    it("annulée avec un montant encaissé : le débit est dit, avec une issue (contacter l’hôtel)", async () => {
      installBff({
        [CONFIRM_URL]: [
          failWith(409, {
            reason: ["reservation-cancelled"],
            debit: ["captured"],
          }),
        ],
      });
      renderConfirmation();

      const debit = await screen.findByTestId("confirmation-debit-captured");
      expect(debit).toHaveTextContent(/encaissé/);
      expect(screen.queryByTestId("confirmation-no-debit")).toBeNull();
      expect(screen.getByTestId("confirmation-home")).toBeVisible();
    });

    it("sans contexte de séjour : pas de CTA d’alternatives inventé, l’accueil reste", async () => {
      installBff({
        [CONFIRM_URL]: [failWith(409, { reason: ["room-unavailable"] })],
      });
      renderConfirmation({ context: null });

      await screen.findByTestId("confirmation-failed");
      expect(screen.queryByTestId("confirmation-alternatives")).toBeNull();
      expect(screen.getByTestId("confirmation-home")).toBeVisible();
      expect(screen.getByTestId("confirmation-no-debit")).toBeVisible();
    });

    it("rendu anglais : titre, statut de débit et CTA traduits", async () => {
      installBff({
        [CONFIRM_URL]: [
          failWith(409, { reason: ["room-unavailable"], debit: ["refunded"] }),
        ],
      });
      renderConfirmation({ locale: "en" });

      const panel = await screen.findByTestId("confirmation-failed");
      expect(panel).toHaveTextContent("Room no longer available");
      expect(
        screen.getByTestId("confirmation-debit-refunded"),
      ).toHaveTextContent(/Full refund issued/);
      expect(screen.getByTestId("confirmation-alternatives")).toHaveTextContent(
        "See available rooms",
      );
    });
  });

  describe("i18n — parité fr/en", () => {
    it("rend la preuve en anglais sans clé manquante", async () => {
      installBff({
        [CONFIRM_URL]: [ok(proof())],
        [QR_URL]: [{ status: 200, blob: PNG }],
      });
      renderConfirmation({ locale: "en" });

      expect(await screen.findByTestId("confirmation-badge")).toHaveTextContent(
        "Confirmed",
      );
      expect(screen.getByTestId("confirmation-account-cta")).toHaveTextContent(
        "My bookings",
      );
    });

    it("chaque clé de booking.confirmation existe dans les deux langues", () => {
      const keys = (value: unknown, prefix = ""): string[] =>
        typeof value === "object" && value !== null
          ? Object.entries(value).flatMap(([k, v]) =>
              keys(v, prefix ? `${prefix}.${k}` : k),
            )
          : [prefix];

      expect(keys(enMessages.booking.confirmation).sort()).toEqual(
        keys(frMessages.booking.confirmation).sort(),
      );
    });
  });
});
