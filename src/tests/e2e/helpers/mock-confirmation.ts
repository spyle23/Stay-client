import type { Page, Route } from "@playwright/test";

/**
 * Interception du BFF pour la **confirmation ferme** (story 3.2) dans les e2e isolés.
 *
 * Trois routes : la confirmation (`POST /payment/reservations/:id/confirm`), puis les deux
 * documents de la preuve (`GET /booking/reservations/:id/confirmation-qr|pdf`).
 *
 * ⚠️ Ordre de déclaration : Playwright donne la priorité à la route déclarée en DERNIER. Une suite
 * qui intercepte aussi `**\/booking/reservations**` (création, relecture) doit appeler ce helper
 * APRÈS, sinon ses documents seraient servis en JSON de réservation.
 */
export const CONFIRM_ROUTE = "**/api/v1/payment/reservations/*/confirm";
export const QR_ROUTE = "**/api/v1/booking/reservations/*/confirmation-qr";
export const PDF_ROUTE = "**/api/v1/booking/reservations/*/confirmation-pdf";

/** PNG 1×1 valide : le navigateur doit réellement décoder l'image (pas un faux-vert). */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** PDF minimal : seule la signature `%PDF` compte pour le téléchargement. */
export const PDF_BYTES = Buffer.from("%PDF-1.7\n%%EOF\n", "utf-8");

/** Preuve renvoyée par le BFF — miroir du `ConfirmationProofDto` (sans PII ni jeton). */
export function confirmationProof(
  reservationId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reservationId,
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
    total: 16_800,
    roomTotal: 16_800,
    servicesTotal: 0,
    services: [],
    capturedAmount: 16_800,
    communicationLocale: "en",
    communicationLocaleState: "hotel_default_fallback",
    alreadyConfirmed: false,
    ...overrides,
  };
}

/** Réponse de confirmation : succès (preuve) ou refus (statut + motif machine). */
export interface ConfirmOutcome {
  status?: number;
  reason?: string;
  proof?: Record<string, unknown>;
}

export interface ConfirmationMock {
  /** Corps des confirmations réellement émises (méthode comprise). */
  confirmCalls: { method: string }[];
  qrCalls: number;
  pdfCalls: number;
}

async function fulfillConfirm(
  route: Route,
  reservationId: string,
  outcome: ConfirmOutcome,
): Promise<void> {
  const status = outcome.status ?? 200;
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
    body: JSON.stringify(
      status >= 400
        ? {
            success: false,
            // Texte technique du BFF : il ne doit JAMAIS apparaître à l'écran.
            message: "Refus du BFF",
            errors: outcome.reason ? { reason: [outcome.reason] } : {},
          }
        : {
            success: true,
            data: outcome.proof ?? confirmationProof(reservationId),
          },
    ),
  });
}

/**
 * Pose les trois routes. `sequence` enchaîne les réponses successives de la confirmation (la
 * dernière se répète), ce qui permet « refus puis succès » pour tester « Réessayer ».
 */
export async function mockConfirmation(
  page: Page,
  reservationId: string,
  options: {
    sequence?: ConfirmOutcome[];
    qrStatus?: number;
    pdfStatus?: number;
    pdfDelayMs?: number;
  } = {},
): Promise<ConfirmationMock> {
  const mock: ConfirmationMock = { confirmCalls: [], qrCalls: 0, pdfCalls: 0 };
  const sequence = options.sequence ?? [{}];

  await page.route(CONFIRM_ROUTE, async (route) => {
    const index = Math.min(mock.confirmCalls.length, sequence.length - 1);
    mock.confirmCalls.push({ method: route.request().method() });
    await fulfillConfirm(route, reservationId, sequence[index]);
  });

  await page.route(QR_ROUTE, async (route) => {
    mock.qrCalls++;
    const status = options.qrStatus ?? 200;
    await route.fulfill(
      status === 200
        ? {
            status,
            contentType: "image/png",
            headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
            body: PNG_1PX,
          }
        : {
            status,
            contentType: "application/json",
            body: JSON.stringify({ success: false, message: "Introuvable" }),
          },
    );
  });

  await page.route(PDF_ROUTE, async (route) => {
    mock.pdfCalls++;
    if (options.pdfDelayMs !== undefined) {
      await new Promise((r) => setTimeout(r, options.pdfDelayMs));
    }
    const status = options.pdfStatus ?? 200;
    await route.fulfill(
      status === 200
        ? {
            status,
            contentType: "application/pdf",
            headers: {
              "Cache-Control": "no-store, private",
              Vary: "Cookie",
              "Content-Disposition":
                'attachment; filename="RES-20990901-A1B2C.pdf"',
            },
            body: PDF_BYTES,
          }
        : {
            status,
            contentType: "application/json",
            body: JSON.stringify({ success: false, message: "Introuvable" }),
          },
    );
  });

  return mock;
}
