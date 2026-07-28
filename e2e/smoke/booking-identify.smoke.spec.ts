import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — identification invité ou compte (Phase 3, périmètre CLIENT, story 2.3).
 * Tourne contre le VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000
 * (`/auth/guest`) → PMS :5231. Aucune API mockée, **un vrai `Customer` est créé** dans le PMS.
 *
 * Ce que l'e2e isolé ne peut pas prouver :
 * - le mot de passe généré par le BFF passe réellement la politique du PMS (un tirage non
 *   conforme y produirait un 400 indiscernable d'une collision) ;
 * - le cookie de session posé après provisioning est **invisible à JavaScript** (NFR-8) ;
 * - rejouer le **même** email produit bien un 409 → écran de collision (AC-2), contre la vraie
 *   contrainte d'unicité du PMS ;
 * - l'écran est WCAG 2.1 AA avec de vraies données, en clair et en sombre.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function searchUrl(): string {
  const params = new URLSearchParams({
    destination: "a",
    checkInDate: futureDate(30),
    checkOutDate: futureDate(33),
    guests: "2",
    currency: "EUR",
  });
  return `/search?${params.toString()}`;
}

/** Collecte les erreurs **console ET réseau** (AC-13 : « 0 erreur console/réseau »). */
function watchForFailures(page: Page, expected: number[] = []): string[] {
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Chromium journalise TOUTE réponse ≥ 400 en erreur console (« Failed to load resource: …
    // status of 409 »). Un statut volontairement provoqué par le scénario doit donc être filtré
    // ici aussi, sinon la surveillance console rendrait le test impossible à écrire.
    const status = /status of (\d{3})/.exec(msg.text())?.[1];
    if (status !== undefined && expected.includes(Number(status))) return;
    failures.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    failures.push(
      `requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "inconnu"}`,
    );
  });
  page.on("response", (res) => {
    // `expected` recense les statuts volontairement provoqués par un scénario (le 409 de
    // collision, par exemple) : sans ce paramètre, le test dédié devait renoncer à toute
    // surveillance console/réseau — et n'en avait donc aucune.
    if (
      res.status() >= 400 &&
      /\/api\/v1\//.test(res.url()) &&
      !expected.includes(res.status())
    ) {
      failures.push(
        `http ${res.status()}: ${res.request().method()} ${res.url()}`,
      );
    }
  });
  return failures;
}

/** Parcours réel jusqu'à l'étape d'identification, en partant de la recherche. */
async function goToIdentify(page: Page): Promise<void> {
  await page.goto(searchUrl());
  const firstCard = page.getByTestId("hotel-card").first();
  await expect(firstCard).toBeVisible({ timeout: 20_000 });
  await firstCard.click();

  const roomCta = page.getByTestId("room-card-cta").first();
  await expect(roomCta).toBeVisible({ timeout: 20_000 });
  await roomCta.click();
  await page.getByTestId("room-book-cta").click();

  await expect(page.getByTestId("booking-summary")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("booking-continue").click();
  await expect(page).toHaveURL(/\/booking\/identify\?/);
}

test("Checkout invité contre le vrai PMS : compte provisionné, session opaque, passage au paiement", async ({
  page,
}) => {
  const failures = watchForFailures(page);
  // Email unique : le PMS impose l'unicité et ce compte reste en base (cf. dette 2.1).
  const email = `smoke-2-3-${Date.now()}@example.com`;

  await goToIdentify(page);

  // Invité par défaut, aucune inscription forcée (AC-3/AC-5).
  const form = page.getByTestId("guest-form");
  await expect(form).toBeVisible({ timeout: 20_000 });
  // Le récapitulatif reste persistant à cette étape (UX-DR-2.5).
  await expect(page.getByTestId("booking-summary")).toBeVisible();
  // L'adresse de confirmation est annoncée avant la saisie (AC-4).
  await expect(page.getByTestId("guest-email-help")).toBeVisible();

  // AC-11 : accessibilité de l'écran réel, en clair puis en sombre.
  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations).toEqual([]);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations).toEqual([]);
  await page.getByTestId("theme-toggle").click();

  await page.getByTestId("guest-first-name").fill("Hery");
  await page.getByTestId("guest-last-name").fill("Rakoto");
  await page.getByTestId("guest-email").fill(email);
  await page.getByTestId("guest-phone").fill("+261340000000");
  await page.getByTestId("guest-submit").click();

  // AC-1/AC-8 : la session est ouverte et le tunnel continue, contexte préservé.
  await expect(page).toHaveURL(/\/booking\/payment\?/, { timeout: 20_000 });
  await expect(page.getByTestId("booking-payment-placeholder")).toBeVisible();
  await expect(page).toHaveURL(/hotelId=/);
  await expect(page).toHaveURL(/checkInDate=/);

  // AC-6/NFR-8 : le cookie de session est HttpOnly — invisible à JavaScript — et aucun jeton
  // ni mot de passe n'est stocké côté navigateur.
  const visibleCookies = await page.evaluate(() => document.cookie);
  expect(visibleCookies).not.toContain("stay_sid");
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toMatch(/token|password/i);

  // La session existe pourtant bien côté serveur.
  //
  // ⚠️ `status === 200` ne prouverait RIEN : `/auth/session` répond 200 même pour un anonyme
  // (invariant délibéré du BFF, pour ne pas produire de bruit 401 sur chaque page). C'est le
  // corps — `authenticated` et l'email — qui atteste du provisioning.
  const session = await page.request.get(
    "http://localhost:4000/api/v1/auth/session",
  );
  expect(session.status()).toBe(200);
  const body = (await session.json()) as {
    data: { authenticated: boolean; user: { email: string } | null };
  };
  expect(body.data.authenticated).toBe(true);
  expect(body.data.user?.email).toBe(email);

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

test("email déjà connu du PMS : invitation à se connecter, sans doublon ni cul-de-sac", async ({
  page,
}) => {
  // Le 409 est le résultat **attendu** de ce scénario ; tout autre échec réseau reste surveillé.
  const failures = watchForFailures(page, [409]);
  const email = `smoke-2-3-dup-${Date.now()}@example.com`;

  // 1er passage : le compte est réellement créé côté PMS.
  await goToIdentify(page);
  await expect(page.getByTestId("guest-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("guest-first-name").fill("Hery");
  await page.getByTestId("guest-last-name").fill("Rakoto");
  await page.getByTestId("guest-email").fill(email);
  await page.getByTestId("guest-phone").fill("+261340000000");
  await page.getByTestId("guest-submit").click();
  await expect(page).toHaveURL(/\/booking\/payment\?/, { timeout: 20_000 });

  // 2ᵉ passage dans un contexte vierge : même email, session repartie de zéro.
  await page.context().clearCookies();
  await goToIdentify(page);
  await expect(page.getByTestId("guest-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("guest-first-name").fill("Hery");
  await page.getByTestId("guest-last-name").fill("Rakoto");
  await page.getByTestId("guest-email").fill(email);
  await page.getByTestId("guest-phone").fill("+261340000000");
  await page.getByTestId("guest-submit").click();

  // AC-2 : invitation à se connecter, email pré-rempli, aucun second compte créé.
  await expect(page.getByTestId("guest-email-conflict")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("login-email")).toHaveValue(email);
  await expect(page).toHaveURL(/\/booking\/identify/);

  // AC-7 : deux issues praticables — se connecter, ou changer d'adresse.
  await expect(page.getByTestId("login-form")).toBeVisible();
  await page.getByTestId("guest-use-another-email").click();
  await expect(page.getByTestId("guest-form")).toBeVisible();
  await expect(page.getByTestId("guest-email")).toHaveValue("");

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

/**
 * AC-13 exige explicitement « **connexion** réelle → identité pré-remplie ». Le parcours compte
 * n'était couvert nulle part contre le vrai stack : on inscrit un `Customer` directement au PMS
 * (comme le fait le smoke d'auth de la story 2.1), puis on se connecte **depuis le tunnel**.
 */
test("connexion réelle depuis le tunnel : identité pré-remplie, sans quitter l’étape", async ({
  page,
  request,
}) => {
  const failures = watchForFailures(page);
  const email = `smoke-2-3-login-${Date.now()}@example.com`;
  const password = "Smoke2-3!Pass";

  const registered = await request.post(
    "http://localhost:5231/api/v1/auth/register/customer",
    {
      data: {
        firstName: "Hery",
        lastName: "Rakoto",
        email,
        password,
        confirmPassword: password,
        phone: "+261340000002",
      },
    },
  );
  expect(registered.status()).toBe(201);

  await goToIdentify(page);
  await expect(page.getByTestId("guest-form")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("identify-tab-account").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();

  // Mode in situ : l'écran se recompose sur place, sans navigation (AC-3/AC-5).
  await expect(page.getByTestId("identify-signed-in")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("identify-identity")).toContainText(email);
  await expect(page.getByTestId("identify-identity")).toContainText("Hery");
  await expect(page).toHaveURL(/\/booking\/identify/);
  await expect(page.getByTestId("guest-form")).toHaveCount(0);

  // Et le tunnel reste franchissable depuis ce panneau.
  await page.getByTestId("identify-continue").click();
  await expect(page).toHaveURL(/\/booking\/payment\?/, { timeout: 20_000 });

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});
