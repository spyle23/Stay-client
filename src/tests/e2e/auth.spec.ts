import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * E2E isolé de la connexion (Story 2.1) — BFF **mocké** via `page.route` (aucun backend).
 *
 * Couvre ce qui est observable côté navigateur sans stack réel :
 * - la garde `proxy.ts` (redirection d'un visiteur anonyme vers `/login?next=…`) ;
 * - le parcours de connexion et la redirection vers `next` ;
 * - la garde **anti open-redirect** du paramètre `next` ;
 * - l'**accessibilité** WCAG 2.1 AA de `/login` (clair + sombre).
 *
 * La preuve que le cookie est bien **HttpOnly** et que la session survit au vrai BFF vit dans le
 * smoke full-stack (`e2e/smoke/auth.smoke.spec.ts`) : ici, le cookie est posé par un mock.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const SESSION_USER = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "voyageur@example.com",
  firstName: "Rakoto",
  lastName: "Randria",
};

/** Mocke `GET /auth/session` (anonyme par défaut) et `POST /auth/login`. */
async function mockAuth(
  page: import("@playwright/test").Page,
  options: { authenticated?: boolean; loginStatus?: number } = {},
) {
  let authenticated = options.authenticated ?? false;

  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: authenticated
          ? { authenticated: true, user: SESSION_USER }
          : { authenticated: false, user: null },
      }),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    const status = options.loginStatus ?? 200;
    if (status !== 200) {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: "refusé" }),
      });
      return;
    }
    authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // Cookie de session factice : indispensable pour que la garde `proxy.ts` (test de
      // présence) laisse passer `/account` après connexion, comme le ferait le vrai BFF.
      headers: { "set-cookie": "stay_sid=e2e-sid.e2e-signature; Path=/" },
      body: JSON.stringify({
        success: true,
        data: { authenticated: true, user: SESSION_USER },
      }),
    });
  });
}

async function signIn(page: import("@playwright/test").Page) {
  await page.getByTestId("login-email").fill("voyageur@example.com");
  await page.getByTestId("login-password").fill("secret123");
  await page.getByTestId("login-submit").click();
}

test.describe("Connexion (isolé, BFF mocké)", () => {
  test("un visiteur anonyme sur /account est redirigé vers /login?next=/account", async ({
    page,
  }) => {
    await mockAuth(page);

    await page.goto("/account");

    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
    await expect(page.getByTestId("login-form")).toBeVisible();
  });

  test("connexion réussie → retour sur la destination initiale", async ({
    page,
  }) => {
    await mockAuth(page);

    await page.goto("/login?next=%2Faccount");
    await signIn(page);

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("account-page")).toBeVisible();
    await expect(page.getByTestId("account-page")).toContainText(
      "voyageur@example.com",
    );
  });

  test("identifiants refusés → message générique, aucune redirection", async ({
    page,
  }) => {
    await mockAuth(page, { loginStatus: 400 });

    await page.goto("/login");
    await signIn(page);

    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("garde anti open-redirect : un `next` externe retombe sur /account", async ({
    page,
  }) => {
    await mockAuth(page);

    await page.goto("/login?next=https%3A%2F%2Fevil.example%2Fphish");
    await signIn(page);

    await expect(page).toHaveURL(/\/account$/);
  });

  test("axe : page de connexion sans violation, clair + sombre", async ({
    page,
  }) => {
    await mockAuth(page);

    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });

  test("axe : erreurs de formulaire annoncées et sans violation", async ({
    page,
  }) => {
    await mockAuth(page);

    await page.goto("/login");
    await page.getByTestId("login-submit").click();

    // `role="alert"` porté par FieldError → annonce lecteur d'écran.
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("login-email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
