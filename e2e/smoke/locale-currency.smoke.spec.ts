import { test, expect } from "@playwright/test";

/**
 * Smoke full-stack (Phase 3, périmètre CLIENT) — parcours i18n + devise de la
 * Story 1.5 contre le VRAI stack (`scripts/client-stack-up.ps1`, front :3001).
 * Prouve que la bascule langue/devise fonctionne bout en bout sans erreur console.
 */
test("bascule langue/devise sur l'accueil, sans erreur console", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "fr");

  // Langue : fr → en (retraduction + lang, même URL).
  await page.getByTestId("locale-switcher").click();
  await page.getByTestId("locale-option-en").click();
  await expect(html).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).pathname).toBe("/");

  // Devise de travail : EUR → USD, persistée au rechargement.
  await page.getByTestId("currency-switcher").click();
  await page.getByTestId("currency-option-USD").click();
  await expect(page.getByTestId("currency-switcher")).toContainText("USD");
  await page.reload();
  await expect(page.getByTestId("currency-switcher")).toContainText("USD");

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
