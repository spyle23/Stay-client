import { readFile } from "node:fs/promises";

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  confirmationProof,
  mockConfirmation,
  type ConfirmOutcome,
} from "./helpers/mock-confirmation";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SESSION_ROUTE = "**/api/v1/auth/session";

/** Date-only UTC décalée de `days` jours. */
function isoDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function confirmationUrl(withContext = true): string {
  const query = new URLSearchParams({ reservationId: RESERVATION_ID });
  if (withContext) {
    query.set("hotelId", HOTEL_ID);
    query.set("roomId", ROOM_ID);
    query.set("checkInDate", isoDatePlus(30));
    query.set("checkOutDate", isoDatePlus(32));
    query.set("guests", "2");
    query.set("currency", "EUR");
  }
  return `/booking/confirmation?${query.toString()}`;
}

async function mockSession(page: Page): Promise<void> {
  await page.route(SESSION_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          user: {
            userId: "u-1",
            email: "voyageur@example.com",
            firstName: "Rakoto",
            lastName: "Randria",
          },
        },
      }),
    }),
  );
}

/** Erreurs de page et de console : la preuve doit s'afficher sans aucune. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  return errors;
}

async function openConfirmation(
  page: Page,
  options: { sequence?: ConfirmOutcome[]; withContext?: boolean } = {},
) {
  await mockSession(page);
  const mock = await mockConfirmation(page, RESERVATION_ID, {
    sequence: options.sequence,
  });
  await page.goto(confirmationUrl(options.withContext ?? true));
  return mock;
}

/**
 * Story 3.2 — page de confirmation, e2e **isolé** (BFF intercepté par `page.route`).
 *
 * Ce qui se prouve ici et pas en intégration : la requête réellement émise (POST unique par
 * montage, rechargement compris), le QR **effectivement décodé** par le navigateur, le PDF
 * réellement téléchargé, et l'audit axe en clair et en sombre. La capture réelle (Stripe en mode
 * test) est couverte par le smoke full-stack.
 */
test.describe("Confirmation ferme (story 3.2)", () => {
  test("confirme une seule fois et affiche la preuve, QR chargé", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const mock = await openConfirmation(page);

    await expect(page.getByTestId("confirmation-proof")).toBeVisible();
    await expect(page.getByTestId("confirmation-badge")).toHaveText(
      /Confirmée/,
    );
    await expect(page.getByTestId("confirmation-code")).toHaveText(
      "RES-20990901-A1B2C",
    );
    await expect(page.getByTestId("confirmation-title")).toBeFocused();

    // QR effectivement DÉCODÉ (attente explicite), pas seulement présent dans le DOM.
    const qr = page.getByTestId("confirmation-qr-image");
    await expect(qr).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    expect(mock.confirmCalls).toEqual([{ method: "POST" }]);
    expect(mock.qrCalls).toBe(1);
    expect(mock.pdfCalls).toBe(0);
    expect(errors).toEqual([]);
  });

  test("rechargement : la même preuve, une confirmation par chargement", async ({
    page,
  }) => {
    const mock = await openConfirmation(page, {
      sequence: [
        {},
        {
          proof: confirmationProof(RESERVATION_ID, { alreadyConfirmed: true }),
        },
      ],
    });
    await expect(page.getByTestId("confirmation-code")).toHaveText(
      "RES-20990901-A1B2C",
    );

    await page.reload();

    await expect(page.getByTestId("confirmation-proof")).toBeVisible();
    await expect(page.getByTestId("confirmation-code")).toHaveText(
      "RES-20990901-A1B2C",
    );
    expect(mock.confirmCalls).toHaveLength(2);
  });

  test("PDF à la demande : génération annoncée puis fichier %PDF téléchargé", async ({
    page,
  }) => {
    await mockSession(page);
    const mock = await mockConfirmation(page, RESERVATION_ID, {
      pdfDelayMs: 300,
    });
    await page.goto(confirmationUrl());
    await expect(page.getByTestId("confirmation-proof")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByTestId("confirmation-pdf").click();
    await expect(page.getByTestId("confirmation-pdf")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    const file = await download;
    expect(file.suggestedFilename()).toBe("RES-20990901-A1B2C.pdf");
    const bytes = await readFile((await file.path())!);
    expect(bytes.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    await expect(page.getByTestId("confirmation-pdf-status")).toHaveText(
      /téléchargement a démarré/,
    );
    expect(mock.pdfCalls).toBe(1);
  });

  test("CTA « mes réservations » vers /account", async ({ page }) => {
    await openConfirmation(page);
    await expect(page.getByTestId("confirmation-account-cta")).toHaveAttribute(
      "href",
      "/account",
    );
  });

  test("capture refusée par Stripe : motif, débit non établi mais rejeu sûr, « Réessayer » aboutit", async ({
    page,
  }) => {
    const mock = await openConfirmation(page, {
      sequence: [{ status: 502, reason: "capture-failed" }, {}],
    });

    const panel = page.getByTestId("confirmation-failed");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-reason", "capture-failed");
    // #184 : une capture non aboutie (restée `processing`) n'établit pas l'absence de débit.
    await expect(page.getByTestId("confirmation-debit-unknown")).toContainText(
      "ne vous débitera jamais deux fois",
    );
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
    await expect(panel).not.toContainText("Refus du BFF");

    await page.getByTestId("confirmation-retry").click();

    await expect(page.getByTestId("confirmation-proof")).toBeVisible();
    expect(mock.confirmCalls).toHaveLength(2);
  });

  test("autorisation expirée : aucune invitation à réessayer, retour au récapitulatif", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 502, reason: "authorisation-expired" }],
    });

    await expect(page.getByTestId("confirmation-failed")).toHaveAttribute(
      "data-reason",
      "authorisation-expired",
    );
    await expect(page.getByTestId("confirmation-retry")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-recap")).toHaveAttribute(
      "href",
      /\/booking\/recap\?/,
    );
    await expect(page.getByTestId("confirmation-home")).toHaveAttribute(
      "href",
      "/",
    );
  });

  test("#4 AC-7 : chambre prise — « aucun débit » et CTA vers les chambres de l’hôtel, même séjour", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 409, reason: "room-unavailable", debit: "none" }],
    });

    const panel = page.getByTestId("confirmation-failed");
    await expect(panel).toHaveAttribute("data-reason", "room-unavailable");
    await expect(page.getByTestId("confirmation-no-debit")).toContainText(
      "Aucun débit n'a été conservé",
    );
    await expect(page.getByTestId("confirmation-retry")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-recap")).toHaveCount(0);
    await expect(panel).not.toContainText("Refus du BFF");

    const cta = page.getByTestId("confirmation-alternatives");
    const href = new URL(
      (await cta.getAttribute("href")) ?? "",
      "http://localhost",
    );
    expect(href.pathname).toBe(`/hotels/${HOTEL_ID}`);
    expect(href.searchParams.get("checkInDate")).toBe(isoDatePlus(30));
    expect(href.searchParams.get("checkOutDate")).toBe(isoDatePlus(32));
    expect(href.searchParams.get("guests")).toBe("2");
  });

  test("#4 AC-5 / AC-8 : argent remboursé — « remboursement intégral émis », jamais « aucun débit »", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [
        { status: 409, reason: "room-unavailable", debit: "refunded" },
      ],
    });

    await expect(page.getByTestId("confirmation-debit-refunded")).toContainText(
      "Remboursement intégral émis",
    );
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
  });

  test("#4 AC-8 : chambre prise, débit non établi par le BFF — jamais « aucun débit »", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 409, reason: "room-unavailable" }],
    });

    await expect(page.getByTestId("confirmation-debit-unknown")).toContainText(
      "pas encore pu être vérifié",
    );
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-alternatives")).toBeVisible();
  });

  test("#183 AC-2 : hold expiré, paiement non vérifié — « vérification en cours », jamais « aucun paiement autorisé », puis « Réessayer » aboutit", async ({
    page,
  }) => {
    const mock = await openConfirmation(page, {
      sequence: [
        { status: 503, reason: "payment-verification-pending" },
        { status: 503, reason: "payment-verification-pending" },
        {},
      ],
    });

    const panel = page.getByTestId("confirmation-failed");
    await expect(panel).toHaveAttribute(
      "data-reason",
      "payment-verification-pending",
    );
    await expect(panel).toContainText("Vérification du paiement en cours");
    await expect(panel).not.toContainText("Aucun paiement autorisé");
    await expect(panel).not.toContainText("Reprenez le paiement");
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-debit-unknown")).toBeVisible();
    await expect(page.getByTestId("confirmation-recap")).toHaveCount(0);
    // Contraste AA du panneau d'échec (motif nouveau, même gabarit).
    const audit = await new AxeBuilder({ page })
      .include("[data-testid='confirmation-failed']")
      .withTags(WCAG_TAGS)
      .analyze();
    expect(audit.violations).toEqual([]);

    await page.getByTestId("confirmation-retry").click();

    await expect(page.getByTestId("confirmation-proof")).toBeVisible();
    expect(mock.confirmCalls).toHaveLength(3);
  });

  test("#4 AC-8 : paiement non libéré (503, retenue posée) — retenue énoncée, puis « Réessayer » aboutit", async ({
    page,
  }) => {
    const mock = await openConfirmation(page, {
      sequence: [
        { status: 503, debit: "held" },
        { status: 503, debit: "held" },
        {},
      ],
    });

    await expect(page.getByTestId("confirmation-debit-held")).toContainText(
      "réservé sur votre carte",
    );
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-failed")).not.toContainText(
      "Refus du BFF",
    );

    await page.getByTestId("confirmation-retry").click();

    await expect(page.getByTestId("confirmation-proof")).toBeVisible();
    expect(mock.confirmCalls.length).toBeGreaterThanOrEqual(3);
  });

  test("#184 AC-1 : refus déterministe, aucun débit établi — « Aucun débit n'a été conservé » reste affiché", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 409, reason: "amount-mismatch", debit: "none" }],
    });

    const panel = page.getByTestId("confirmation-failed");
    await expect(panel).toHaveAttribute("data-reason", "amount-mismatch");
    await expect(page.getByTestId("confirmation-no-debit")).toContainText(
      "Aucun débit n'a été conservé",
    );
    await expect(page.getByTestId("confirmation-retry")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-recap")).toBeVisible();
  });

  test("#184 AC-1 : paiement non autorisé — l'absence de débit établie par le motif", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 409, reason: "payment-not-authorized" }],
    });

    await expect(page.getByTestId("confirmation-no-debit")).toContainText(
      "Aucun débit n'a été conservé",
    );
  });

  test("#184 : montant divergent sans statut du BFF — jamais « aucun débit » ni « rien encaissé »", async ({
    page,
  }) => {
    await openConfirmation(page, {
      sequence: [{ status: 409, reason: "amount-mismatch" }],
    });

    const panel = page.getByTestId("confirmation-failed");
    await expect(page.getByTestId("confirmation-debit-unknown")).toBeVisible();
    await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
    await expect(panel).not.toContainText("rien encaissé");
  });

  for (const { reason, status } of [
    { reason: "unavailable", status: 503 },
    { reason: "unknown", status: 500 },
  ]) {
    test(`#184 AC-2 : ${reason} — texte honnête au lieu de « aucun débit », « Réessayer » aboutit`, async ({
      page,
    }) => {
      const mock = await openConfirmation(page, {
        sequence: [{ status }, { status }, {}],
      });

      const panel = page.getByTestId("confirmation-failed");
      await expect(panel).toHaveAttribute("data-reason", reason);
      const debit = page.getByTestId("confirmation-debit-unknown");
      await expect(debit).toContainText(
        "Réessayer la confirmation ne vous débitera jamais deux fois",
      );
      await expect(debit).toHaveAttribute("data-retry-safe", "true");
      await expect(page.getByTestId("confirmation-no-debit")).toHaveCount(0);
      await expect(panel).not.toContainText("Aucun débit n'a été conservé");

      await page.getByTestId("confirmation-retry").click();

      await expect(page.getByTestId("confirmation-proof")).toBeVisible();
      expect(mock.confirmCalls).toHaveLength(3);
    });
  }

  test("lien sans identifiant exploitable : état explicite, aucun appel au BFF", async ({
    page,
  }) => {
    // Seuls les appels au BFF comptent (la navigation vers la page porte, elle, « /confirmation »).
    let bffCalls = 0;
    page.on("request", (req) => {
      const url = req.url();
      if (
        url.includes("/api/v1/payment/") ||
        url.includes("/confirmation-qr") ||
        url.includes("/confirmation-pdf")
      ) {
        bffCalls++;
      }
    });
    await mockSession(page);

    await page.goto("/booking/confirmation?reservationId=pas-un-guid");

    await expect(page.getByTestId("confirmation-invalid")).toBeVisible();
    await expect(page.getByTestId("confirmation-invalid-home")).toHaveAttribute(
      "href",
      "/",
    );
    expect(bffCalls).toBe(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe AA sans violation — thème ${theme}, preuve et échec`, async ({
      page,
    }) => {
      test.slow();
      await page.emulateMedia({ colorScheme: theme });

      await openConfirmation(page);
      await expect(page.getByTestId("confirmation-qr-image")).toBeVisible();
      const proof = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(proof.violations, `preuve (${theme})`).toEqual([]);

      // Contraste au focus : le CTA et le bouton PDF focalisés restent audités.
      await page.getByTestId("confirmation-pdf").focus();
      const focused = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(focused.violations, `PDF focalisé (${theme})`).toEqual([]);

      await page.unrouteAll();
      await openConfirmation(page, {
        sequence: [{ status: 502, reason: "capture-failed" }],
      });
      await expect(page.getByTestId("confirmation-failed")).toBeVisible();
      const failure = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(failure.violations, `échec (${theme})`).toEqual([]);

      // #4 : chambre prise, remboursement émis — CTA principal d'alternatives sur le panneau.
      await page.unrouteAll();
      await openConfirmation(page, {
        sequence: [
          { status: 409, reason: "room-unavailable", debit: "refunded" },
        ],
      });
      await expect(page.getByTestId("confirmation-alternatives")).toBeVisible();
      await page.getByTestId("confirmation-alternatives").focus();
      const unavailable = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(unavailable.violations, `chambre prise (${theme})`).toEqual([]);
    });
  }
});
