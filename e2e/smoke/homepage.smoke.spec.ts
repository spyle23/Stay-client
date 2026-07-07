import { test, expect, request } from "@playwright/test";

/**
 * Smoke full-stack de l'Application Cliente (Phase 3, périmètre CLIENT).
 * Tourne contre le VRAI stack lancé par `scripts/client-stack-up.ps1` :
 *   front :3001 → BFF :4000 → PMS :5231 (+ Redis). Aucune API mockée.
 *
 * Objectif : prouver que la chaîne de dépendances est debout et que le parcours
 * principal se charge sans erreur console.
 */
const BFF_URL = process.env.SMOKE_BFF_URL ?? "http://localhost:4000";

test("le BFF répond sur /health/live (liveness)", async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BFF_URL}/health/live`);
  expect(res.status()).toBe(200);
  await ctx.dispose();
});

test("la page d'accueil cliente se charge sans erreur console", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();

  expect(
    consoleErrors,
    `Erreurs console: ${consoleErrors.join(" | ")}`,
  ).toHaveLength(0);
});
