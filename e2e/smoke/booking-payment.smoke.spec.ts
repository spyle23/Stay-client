import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke full-stack — création de la Réservation `Pending` (Phase 3, périmètre CLIENT, story 2.4).
 * Tourne contre le VRAI stack (`scripts/client-stack-up.ps1`) : front :3001 → BFF :4000 → PMS :5231.
 * Aucune API mockée : **une vraie réservation est créée** dans le PMS, et une vraie chambre est
 * immobilisée jusqu'à ce que le balayeur de holds la libère.
 *
 * Ce que l'e2e isolé ne peut pas prouver :
 * - le corps réellement accepté par le PMS (dates ancrées UTC — une date-only y produit un 500) ;
 * - le **total au centime** : le montant persisté par le PMS est bien celui affiché à l'écran ;
 * - l'**idempotence** réelle : une seconde soumission du même séjour ne crée pas de doublon ;
 * - le Code de réservation est bien celui généré par le PMS (`RES-AAAAMMJJ-XXXXX`) ;
 * - que le **statut** réellement renvoyé par le BFF est un statut que l'écran sait lire : un
 *   libellé inattendu tomberait en vue `unknown` et retirerait le paiement — un mock, qui renvoie
 *   toujours `Pending`, ne peut structurellement pas le détecter ;
 * - que la réservation relue décrit bien le séjour de l'URL avec les **noms de champs et le format
 *   de date réels** du PMS (une date sérialisée en instant ISO doit rester le même jour civil) ;
 * - l'écran est WCAG 2.1 AA avec de vraies données, en clair et en sombre — y compris sur le
 *   panneau de réservation créée, qui introduit ses propres surfaces.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ⚠️ Chaque test doit viser des dates **qui lui sont propres**.
 *
 * Ce smoke crée de vraies réservations : la `Pending` du premier test immobilise réellement la
 * chambre (le PMS n'exclut que les `Cancelled` du chevauchement). Deux tests partageant un même
 * séjour se disputeraient donc le même inventaire, et le second se ferait légitimement refuser
 * en « chambre indisponible » — un faux échec qui masquerait ce qu'il est censé prouver.
 *
 * Chaque scénario reçoit donc une **bande de dates propre** via `uniqueStayOffset(slot)` :
 *   slot 0 → création · slot 1 → idempotence · slot 2 → divergence · slot 3 → préférences (2.5).
 *
 * ⚠️ **Une fenêtre fixe rend le test non rejouable pendant toute la durée du hold** (15 min) : la
 * `Pending` du run précédent tient encore la chambre, la recherche ne renvoie plus aucun hôtel
 * disponible, et le test échoue sur une absence de résultat qui n'a rien à voir avec ce qu'il
 * vérifie. Constaté en Phase 3 de la revue 2ᵉ passe. Les scénarios ci-dessus en héritent ; le
 * scénario 2.5 utilise donc `uniqueStayOffset()`, qui décale sa fenêtre à chaque minute.
 */

/**
 * Décalage de séjour d'un scénario, **propre à ce run**.
 *
 * Chaque `slot` occupe sa propre bande de 39 jours (aucun scénario ne peut recouper un autre), et
 * la fenêtre glisse de 3 jours par minute — soit plus que la durée d'un séjour (2 nuits), donc
 * deux exécutions successives ne se disputent jamais la même chambre.
 *
 * Sans cela, la suite n'était **pas rejouable** pendant toute la durée du hold : la `Pending` du
 * run précédent tenait encore la chambre, la recherche ne renvoyait plus aucun hôtel, et les tests
 * échouaient sur une absence de résultat sans rapport avec ce qu'ils vérifient.
 */
function uniqueStayOffset(slot: number): number {
  // ⚠️ Le cycle (20 min) doit rester **supérieur au hold** (15 min par défaut) : avec un cycle plus
  // court, une fenêtre revenait avant que la `Pending` du tour précédent n'ait été libérée — et le
  // test échouait à nouveau sur une chambre indisponible. Le pas (3 j) dépasse la durée d'un séjour
  // (2 nuits), et l'espacement des bandes (70 j) dépasse l'amplitude d'un cycle (60 j).
  return 60 + slot * 70 + (Math.floor(Date.now() / 60_000) % 20) * 3;
}
function searchUrl(startsInDays: number): string {
  const params = new URLSearchParams({
    destination: "a",
    checkInDate: futureDate(startsInDays),
    checkOutDate: futureDate(startsInDays + 2),
    guests: "2",
    currency: "EUR",
  });
  return `/search?${params.toString()}`;
}

/** Collecte les erreurs **console ET réseau** (Phase 3 : « 0 erreur console/réseau »). */
function watchForFailures(page: Page, expected: number[] = []): string[] {
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const status = /status of (\d{3})/.exec(msg.text())?.[1];
    if (status !== undefined && expected.includes(Number(status))) return;
    failures.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    const error = req.failure()?.errorText ?? "inconnu";
    // Une charge utile RSC (`_rsc=`) annulée par une navigation ultérieure n'est pas un défaut :
    // `router.replace` en émet une, et le test enchaîne aussitôt sur un `goto`. Le navigateur
    // abandonne alors la précédente — exactement ce qu'il fait quand un visiteur clique ailleurs
    // pendant un chargement. Filtre volontairement étroit : tout autre échec réseau reste signalé.
    if (error === "net::ERR_ABORTED" && req.url().includes("_rsc=")) {
      return;
    }
    failures.push(`requestfailed: ${req.method()} ${req.url()} — ${error}`);
  });
  page.on("response", (res) => {
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

/** Créations réellement émises par le navigateur — l'invariant « jamais au montage ». */
function watchCreations(page: Page): string[] {
  const creations: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/api/v1/booking/reservations")
    ) {
      creations.push(req.url());
    }
  });
  return creations;
}

/** Parcours réel jusqu'à l'étape de paiement, invité provisionné au passage. */
async function goToPayment(
  page: Page,
  email: string,
  startsInDays: number,
): Promise<void> {
  await page.goto(searchUrl(startsInDays));
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

  await expect(page.getByTestId("guest-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("guest-first-name").fill("Hery");
  await page.getByTestId("guest-last-name").fill("Rakoto");
  await page.getByTestId("guest-email").fill(email);
  await page.getByTestId("guest-phone").fill("+261340000000");
  await page.getByTestId("guest-submit").click();

  await expect(page).toHaveURL(/\/booking\/payment\?/, { timeout: 20_000 });
}

test("Création d’une réservation contre le vrai PMS : code, total au centime, hold et reprise", async ({
  page,
}) => {
  const failures = watchForFailures(page);
  const creations = watchCreations(page);
  const email = `smoke-2-4-${Date.now()}@example.com`;

  await goToPayment(page, email, uniqueStayOffset(0));

  // Le récapitulatif reste persistant, et rien n'est créé tant qu'on n'a pas cliqué.
  await expect(page.getByTestId("booking-summary")).toBeVisible();
  const cta = page.getByTestId("payment-create-cta");
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("payment-reservation-panel")).toHaveCount(0);
  // AC-10 contre le vrai stack : aucune `Pending` n'a été gelée par le simple affichage.
  expect(creations).toHaveLength(0);

  // Le total ANNONCÉ, relevé avant création : c'est lui que le BFF oppose au PMS.
  const announcedTotal = (
    await page.getByTestId("booking-total").innerText()
  ).trim();

  // Accessibilité de l'écran réel, en clair puis en sombre.
  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations, "création (clair)").toEqual([]);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations, "création (sombre)").toEqual([]);
  await page.getByTestId("theme-toggle").click();

  await cta.click();

  // Code de réservation généré par le PMS (jamais recomposé côté BFF).
  const code = page.getByTestId("payment-reservation-code");
  await expect(code).toBeVisible({ timeout: 20_000 });
  await expect(code).toHaveText(/^RES-\d{8}-[A-Z0-9]{5}$/);
  expect(creations).toHaveLength(1);

  /*
   * Le statut réellement renvoyé par le BFF est un statut que l'écran SAIT lire.
   *
   * `data-view` vaut `payable` uniquement sur une `Pending` au hold actif. Un libellé de statut
   * inattendu tomberait en `unknown` et retirerait le paiement — un défaut qu'aucun mock ne peut
   * révéler, puisqu'il répond toujours `Pending`.
   */
  const panel = page.getByTestId("payment-reservation-panel");
  await expect(panel).toHaveAttribute("data-status", "Pending");
  await expect(panel).toHaveAttribute("data-view", "payable");
  await expect(page.getByTestId("payment-element-placeholder")).toBeVisible();
  await expect(page.getByTestId("payment-hold-expired")).toHaveCount(0);

  // AC-2 : le montant persisté par le PMS est celui qui a été annoncé, au centime.
  const total = page.getByTestId("payment-reservation-total");
  await expect(total).toHaveText(announcedTotal);
  // La devise réelle de l'hôtel est connue de l'ICU : sinon l'écran remplacerait le montant par
  // un libellé plutôt que d'afficher un total faux d'un facteur 10ⁿ.
  await expect(total).not.toHaveAttribute("data-amount-unreliable", "true");

  // AC-6 : la chambre est tenue, et l'échéance est annoncée factuellement — avec son fuseau,
  // pour ne pas cohabiter avec l'échéance UTC de la politique d'annulation sans référentiel.
  const hold = page.getByTestId("payment-hold-active");
  await expect(hold).toBeVisible();
  await expect(hold).toHaveText(/\d{1,2}:\d{2}\s*\S+/);

  // L'identifiant rejoint l'URL — c'est lui qui rend la reprise possible.
  await expect(page).toHaveURL(/reservationId=/);
  const reservedUrl = page.url();
  // …et il reste adressable depuis le retour à l'identification (sinon la ré-identification
  // reproposerait une création, l'idempotence du BFF étant clée sur l'utilisateur).
  await expect(page.getByTestId("payment-back-to-identify")).toHaveAttribute(
    "href",
    /reservationId=/,
  );

  // Accessibilité du panneau de réservation créée — surfaces que l'écran de création n'a pas.
  const createdLight = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(createdLight.violations, "réservée (clair)").toEqual([]);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const createdDark = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(createdDark.violations, "réservée (sombre)").toEqual([]);
  await page.getByTestId("theme-toggle").click();

  // AC-9 : un rafraîchissement RELIT la réservation, il n'en crée pas une seconde.
  const beforeReload = creations.length;
  await page.goto(reservedUrl);
  await expect(page.getByTestId("payment-reservation-code")).toHaveText(
    await code.innerText(),
  );
  expect(creations).toHaveLength(beforeReload);
  // La reprise doit retomber sur la MÊME vue : la relecture d'un vrai `BookingReservationDto`
  // (noms de champs et format de date du PMS) décrit bien le séjour porté par l'URL.
  await expect(page.getByTestId("payment-reservation-panel")).toHaveAttribute(
    "data-view",
    "payable",
  );
  await expect(page.getByTestId("payment-reservation-mismatch")).toHaveCount(0);

  // NFR-8 : le cookie de session reste invisible à JavaScript sur cette étape aussi.
  const visibleCookies = await page.evaluate(() => document.cookie);
  expect(visibleCookies).not.toContain("stay_sid");

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

test("Double soumission contre le vrai stack : une seule réservation créée (idempotence)", async ({
  page,
}) => {
  const failures = watchForFailures(page);
  const email = `smoke-2-4-idem-${Date.now()}@example.com`;

  // Séjour distinct du test précédent : sinon sa `Pending` bloquerait réellement cette chambre.
  await goToPayment(page, email, uniqueStayOffset(1));

  const cta = page.getByTestId("payment-create-cta");
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await cta.click();

  const code = page.getByTestId("payment-reservation-code");
  await expect(code).toBeVisible({ timeout: 20_000 });
  const firstCode = await code.innerText();

  // Retour à l'URL SANS `reservationId` : l'écran repropose la création pour le même séjour.
  // L'idempotence du BFF doit renvoyer la MÊME réservation plutôt qu'en geler une seconde.
  const url = new URL(page.url());
  url.searchParams.delete("reservationId");
  await page.goto(url.toString());

  const secondCta = page.getByTestId("payment-create-cta");
  await expect(secondCta).toBeVisible({ timeout: 20_000 });
  await secondCta.click();

  await expect(page.getByTestId("payment-reservation-code")).toHaveText(
    firstCode,
    { timeout: 20_000 },
  );

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

/**
 * Divergence entre la réservation relue et le séjour de l'URL (AC-9).
 *
 * Contre un mock, cette comparaison est tautologique : le mock renvoie ce que le test a écrit.
 * Contre le vrai PMS, elle éprouve les **noms de champs et le format de date réels** —
 * `describesStay` compare des jours civils, et le PMS peut sérialiser ses dates en instant ISO.
 * Un faux positif ici remplacerait « votre chambre est réservée » par un panneau de divergence sur
 * une réservation parfaitement valide ; un faux négatif mettrait deux totaux contradictoires sous
 * les yeux du voyageur juste avant le paiement.
 *
 * ⚠️ Un seul séjour est réellement réservé (J+75). L'URL divergente ne fait que **relire** cette
 * réservation sous un autre nombre de voyageurs : aucune seconde chambre n'est immobilisée.
 */
test("Réservation d’un autre séjour : divergence détectée contre le vrai PMS", async ({
  page,
}) => {
  const failures = watchForFailures(page);
  const creations = watchCreations(page);
  const email = `smoke-2-4-mismatch-${Date.now()}@example.com`;

  await goToPayment(page, email, uniqueStayOffset(2));

  const cta = page.getByTestId("payment-create-cta");
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await cta.click();
  await expect(page.getByTestId("payment-reservation-code")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/reservationId=/);
  expect(creations).toHaveLength(1);

  // Même réservation, séjour de l'URL modifié (URL retouchée / retour d'historique).
  const divergent = new URL(page.url());
  divergent.searchParams.set("guests", "1");
  await page.goto(divergent.toString());

  await expect(page.getByTestId("payment-reservation-mismatch")).toBeVisible({
    timeout: 20_000,
  });
  // Ni « réservée », ni emplacement de paiement : deux totaux contradictoires, jamais.
  await expect(page.getByTestId("payment-reservation-panel")).toHaveCount(0);
  await expect(page.getByTestId("payment-element-placeholder")).toHaveCount(0);
  // Deux issues praticables — et aucune création de plus.
  await expect(page.getByTestId("payment-mismatch-open")).toBeVisible();
  await expect(page.getByTestId("payment-mismatch-restart")).toBeVisible();
  expect(creations).toHaveLength(1);

  // Le lien « ouvrir la réservation existante » ramène bien à une vue payable.
  await page.getByTestId("payment-mismatch-open").click();
  await expect(page.getByTestId("payment-reservation-panel")).toHaveAttribute(
    "data-view",
    "payable",
    { timeout: 20_000 },
  );
  expect(creations).toHaveLength(1);

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

/**
 * Demandes spéciales & langue de communication contre le VRAI PMS (story 2.5, FR-10).
 *
 * Ce que l'e2e isolé ne peut pas prouver :
 * - que le PMS **accepte** réellement `specialRequests` dans le corps de création (aucun validateur
 *   FluentValidation n'existe là-bas : c'est la colonne `varchar(2000)` qui tranche, en 500) ;
 * - que la valeur fait un **aller-retour complet** — écrite à la création, relue par
 *   `GET /roomreservations/{id}` sous le vrai nom de champ, et rendue à l'écran ;
 * - que les accents et les retours à la ligne survivent au trajet BFF → PMS → PostgreSQL → BFF ;
 * - que l'écran de réservation créée reste WCAG AA avec un vrai texte attaché.
 *
 * ⚠️ Ce test crée une **vraie** réservation portant un texte marqueur unique. C'est ce marqueur qui
 * rend la preuve non tautologique : une valeur fixe pourrait provenir d'une réservation antérieure.
 */
test("Demandes spéciales & langue portées jusqu’au vrai PMS et relues", async ({
  page,
}) => {
  const failures = watchForFailures(page);
  const creations = watchCreations(page);
  const stamp = Date.now();
  const email = `smoke-2-5-${stamp}@example.com`;
  // Accents + retour à la ligne : ils éprouvent l'encodage sur toute la chaîne.
  const marker = `Arrivée tardive vers 23 h — réf. ${stamp}\nChambre calme si possible`;

  await goToPayment(page, email, uniqueStayOffset(3));

  const cta = page.getByTestId("payment-create-cta");
  await expect(cta).toBeVisible({ timeout: 20_000 });

  // Les champs sont bien là, facultatifs, et n'empêchent pas de réserver.
  await expect(page.getByTestId("booking-preferences")).toBeVisible();
  await expect(cta).toBeEnabled();

  await page.getByTestId("special-requests-input").fill(marker);
  await page.getByTestId("communication-locale-select").selectOption("en");
  await expect(page.getByTestId("special-requests-counter")).toContainText(
    `${marker.length} / 1000`,
  );

  await cta.click();

  await expect(page.getByTestId("payment-reservation-code")).toBeVisible({
    timeout: 20_000,
  });
  expect(creations).toHaveLength(1);

  /*
   * L'aller-retour PMS : ce qui s'affiche vient de `RoomReservationDto.SpecialRequests`, relu par
   * le BFF — jamais de l'écho de la saisie (le BFF ne réfléchit pas le corps qu'il a envoyé).
   */
  const attached = page.getByTestId("payment-attached-special-requests");
  await expect(attached).toBeVisible();
  await expect(attached).toContainText(`réf. ${stamp}`);
  await expect(attached).toContainText("Chambre calme si possible");
  await expect(page.getByTestId("payment-attached-locale")).toHaveText(
    "English",
  );

  // Lecture seule : le PMS n'expose aucune route de mise à jour au rôle `Customer`.
  const block = page.getByTestId("payment-attached-preferences");
  await expect(block.locator("textarea, select, input")).toHaveCount(0);

  // Et la valeur survit à un rafraîchissement — donc elle est bien PERSISTÉE, pas mémorisée à
  // l'écran (la relecture repasse par `GET /booking/reservations/:id` → PMS).
  //
  // ⚠️ Attendre que `router.replace` ait **commité** l'identifiant dans l'URL avant de recharger.
  // Le panneau s'affiche dès que la mutation répond, donc AVANT que l'URL ne soit à jour :
  // recharger trop tôt repartait sur une URL sans `reservationId`, et la page rendait l'écran de
  // création vierge — un faux échec sans rapport avec la persistance. Même garde que le scénario
  // de reprise de la story 2.4.
  await expect(page).toHaveURL(/reservationId=/, { timeout: 20_000 });
  await page.reload();
  await expect(
    page.getByTestId("payment-attached-special-requests"),
  ).toContainText(`réf. ${stamp}`, { timeout: 20_000 });
  expect(creations).toHaveLength(1);

  // Accessibilité de l'écran avec un vrai texte attaché, dans les deux thèmes.
  const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(light.violations, "préférences attachées (clair)").toEqual([]);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dark.violations, "préférences attachées (sombre)").toEqual([]);
  await page.getByTestId("theme-toggle").click();

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});
