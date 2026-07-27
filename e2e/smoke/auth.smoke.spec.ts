import { test, expect, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — connexion & session (Phase 3, périmètre CLIENT, Story 2.1).
 * Tourne contre le VRAI stack (`scripts/client-stack-up.ps1`) :
 * front :3001 → BFF :4000 (module `auth` + Redis) → PMS :5231. Aucune API mockée.
 *
 * C'est le **seul** contexte où l'on peut vérifier les invariants de sécurité réels :
 * - le cookie de session est bien **HttpOnly** (invisible à `document.cookie`) ;
 * - il est **opaque** : aucun JWT n'y transite (les jetons vivent en Redis côté BFF) ;
 * - la garde `proxy.ts` et le cycle connexion → espace client → déconnexion fonctionnent
 *   de bout en bout avec un vrai compte `Customer`.
 *
 * Le compte de test est créé **directement contre le PMS** (`/auth/register/customer`,
 * anonyme) : l'inscription depuis l'application cliente est la story 4.1, hors périmètre ici.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PMS_URL = process.env.SMOKE_PMS_URL ?? "http://localhost:5231/api/v1";
const PASSWORD = "SmokeTest123!";

let email: string;

test.beforeAll(async () => {
  // Email unique : le PMS refuse les doublons, et le smoke doit être rejouable.
  email = `smoke-2-1-${Date.now()}@example.com`;
  const api = await request.newContext();
  const res = await api.post(`${PMS_URL}/auth/register/customer`, {
    data: {
      firstName: "Smoke",
      lastName: "Voyageur",
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  });
  expect(
    res.ok(),
    `Création du compte de test impossible (${res.status()}) — le PMS :5231 est-il lancé ?`,
  ).toBeTruthy();
  await api.dispose();
});

test("connexion réelle : garde, cookie HttpOnly opaque, espace client, déconnexion", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // 1. Garde : un visiteur anonyme ne peut pas atteindre l'espace client.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  await expect(page.getByTestId("login-form")).toBeVisible();

  // 2. Connexion contre le vrai BFF → vrai PMS.
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(/\/account$/, { timeout: 20_000 });
  await expect(page.getByTestId("account-page")).toContainText(email);

  // 3. Invariants de session (NFR-8) : cookie HttpOnly, opaque, sans jeton.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "stay_sid");
  expect(session, "cookie de session absent").toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  // Opacité : `<sid>.<signature>` en base64url — jamais un JWT (`eyJ…`, 3 segments).
  expect(session?.value).not.toContain("eyJ");
  expect(session?.value.split(".")).toHaveLength(2);

  // Invisible à JavaScript (donc invulnérable au vol par XSS).
  const visibleToJs = await page.evaluate(() => document.cookie);
  expect(visibleToJs).not.toContain("stay_sid");

  // 4. Déconnexion → retour à l'accueil, session révoquée.
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

  // 5. La garde reprend la main : l'espace client est de nouveau inaccessible.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);

  expect(
    consoleErrors,
    `erreurs console: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});

test("identifiants invalides : message générique, aucune session ouverte", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("MauvaisMotDePasse123!");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("login-error")).toBeVisible({
    timeout: 20_000,
  });
  // Aucun cookie de session ne doit avoir été posé.
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "stay_sid")).toBeUndefined();
});

test("axe : page de connexion conforme WCAG 2.1 AA (clair + sombre) sur le stack réel", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-form")).toBeVisible();

  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations).toEqual([]);

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations).toEqual([]);
});
