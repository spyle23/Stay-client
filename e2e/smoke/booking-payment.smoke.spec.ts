import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { lastMail } from "./helpers/mail";
import { watchForFailures, type WatchOptions } from "./helpers/network-probe";
import { openHotelCard, openRoomCard } from "./helpers/navigation";
import { awaitGuestQuota } from "./helpers/guest-quota";
import { paidStayOffset, uniqueStayOffset } from "./helpers/stay-window";

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
 *   panneau de réservation créée, qui introduit ses propres surfaces ;
 * - l'e-mail « demande de réservation » envoyé par le PMS au voyageur, lu dans le capteur SMTP de
 *   la Phase 3 (`helpers/mail.ts`, #109).
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
 * Ce smoke crée de vraies réservations, sur un jeu de référence à une chambre par hôtel : deux
 * tests (ou deux passages d'un même test) partageant un séjour se disputeraient le même inventaire,
 * et le second se ferait légitimement refuser en « chambre indisponible ». Chaque scénario reçoit
 * donc un séjour propre au passage, par `uniqueStayOffset(slot)` (non payant, change à chaque
 * seconde) ou `paidStayOffset(slot)` (payant, tiré au hasard dans sa bande) : voir
 * `helpers/stay-window.ts` (#146).
 *   slot 0 → création · 1 → idempotence · 2 → divergence · 3 → préférences (2.5) · 4 → upsell (2.6).
 */

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

/**
 * Sonde console/réseau de ce smoke : la sonde partagée (`helpers/network-probe.ts`, #125), plus un
 * abandon propre à l'écran de paiement. Il demande son intent (story 3.1) dès qu'il devient payable,
 * et les scénarios qui quittent aussitôt la page (divergence, idempotence, préférences) abandonnent
 * cette requête en vol : ce n'est pas un défaut. Seul cet abandon-là est ignoré ; tout autre échec
 * vers le BFF reste compté.
 */
const PAYMENT_PROBE: WatchOptions = {
  abortablePaths: [/\/payment\/reservations\/[^/]+\/intent$/],
};

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

/**
 * Saisit la carte de test dans le Payment Element (story 3.1).
 *
 * ⚠️ Stripe monte **plusieurs** `__privateStripeFrame` (le formulaire, plus des frames de contrôle
 * invisibles) : un `frameLocator` non qualifié viole le mode strict de Playwright. On repère donc
 * la frame qui porte réellement le champ « numéro de carte », et on saisit tout dedans.
 */
async function fillTestCard(page: Page): Promise<void> {
  const cardLabel = /card number|numéro de carte/i;
  const expiryLabel = /expiration|expiry|MM ?\/ ?YY|MM ?\/ ?AA/i;
  // ⚠️ Les libellés du Payment Element suivent la locale du navigateur, qui n'est pas garantie
  // d'une exécution à l'autre : les deux langues du produit sont donc couvertes.
  const cvcLabel = /CVC|CVV|cryptogramme|code de sécurité|security code/i;
  const selector = 'iframe[name^="__privateStripeFrame"]';

  // ⚠️ L'iframe est attachée bien AVANT que Stripe n'y ait rendu ses champs : inspecter les frames
  // une seule fois ne trouve rien et échoue à tort. On sonde donc jusqu'à ce que le champ existe.
  const deadline = Date.now() + 40_000;
  let target: ReturnType<Page["frameLocator"]> | null = null;

  while (Date.now() < deadline && target === null) {
    const count = await page.locator(selector).count();
    for (let i = 0; i < count; i++) {
      const frame = page.frameLocator(selector).nth(i);
      if ((await frame.getByRole("textbox", { name: cardLabel }).count()) > 0) {
        target = frame;
        break;
      }
    }
    if (target === null) {
      await page.waitForTimeout(500);
    }
  }

  if (target === null) {
    throw new Error(
      "Aucune frame Stripe ne porte le champ « numéro de carte » : le Payment Element n'a pas fini de se monter.",
    );
  }

  const cardNumber = target.getByRole("textbox", { name: cardLabel });
  await expect(cardNumber).toBeVisible({ timeout: 15_000 });
  await cardNumber.fill("4242424242424242");
  await target
    .getByRole("textbox", { name: expiryLabel })
    .fill("12" + String(new Date().getFullYear() + 3).slice(-2));
  await target.getByRole("textbox", { name: cvcLabel }).fill("123");
}

/**
 * Soumet le paiement par un vrai clic sur « Payer », et vérifie que la soumission est partie (#125).
 *
 * ⚠️ Juste après la saisie, le focus est dans l'iframe Stripe (hors origine) et « Payer » est sous la
 * ligne de flottaison. Le clic de Playwright, émis aussitôt après **son propre** défilement, n'atteint
 * alors jamais la page : aucun `pointerdown`, aucun `submit`, le formulaire reste `ready`, et le test
 * attendait 60 s une autorisation jamais demandée (constaté en Phase 3, reproduit au MCP : un second
 * clic, ou un clic après un défilement stabilisé, aboutit). Ce n'est pas un défaut de l'écran : un
 * visiteur fait défiler la page lui-même avant de cliquer.
 *
 * On fait donc défiler d'abord, on laisse deux images au compositeur, puis on clique ; et l'on exige
 * que le formulaire quitte `ready`. Un clic perdu est rejoué ; un clic reçu ne l'est jamais (le
 * formulaire ignore de toute façon un clic pendant la confirmation).
 */
async function submitPayment(page: Page): Promise<void> {
  const submit = page.getByTestId("payment-submit");
  const stillReady = page.locator(
    '[data-testid="payment-form"][data-phase="ready"]',
  );
  await expect(async () => {
    if ((await stillReady.count()) === 0) return;
    await submit.scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await submit.click({ timeout: 5_000 });
    await expect(stillReady).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/** Parcours réel jusqu'à l'étape de paiement, invité provisionné au passage. */
async function goToPayment(
  page: Page,
  email: string,
  startsInDays: number,
): Promise<void> {
  await page.goto(searchUrl(startsInDays));
  await openHotelCard(page);
  // Chambre absente : séjour déjà tenu par un passage récent, encore servi par le cache du BFF
  // (écarté par `uniqueStayOffset`, #146), ou fiche hôtel blanche (course de préchargement
  // corrigée dans le produit par #148).
  await openRoomCard(page);
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
  await awaitGuestQuota();
  await page.getByTestId("guest-submit").click();

  await expect(page).toHaveURL(/\/booking\/payment\?/, { timeout: 20_000 });
}

test("Création d’une réservation contre le vrai PMS : code, total au centime, hold et reprise", async ({
  page,
}) => {
  // Budget élargi (#109) : l'e-mail de demande de réservation passe par la file Hangfire du PMS,
  // sondée toutes les ~15 s ; `lastMail` l'attend jusqu'à 45 s après les vérifications de l'écran.
  test.setTimeout(120_000);
  const failures = watchForFailures(page, PAYMENT_PROBE);
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

  /*
   * #109 AC-2 : l'e-mail « demande de réservation » du PMS atteint bien le voyageur.
   *
   * Le PMS l'inscrit dans son outbox avec la réservation, puis l'envoie par un job Hangfire : il
   * arrive donc APRÈS la réponse, et `lastMail` sonde le capteur SMTP de la Phase 3 (#99). Seul le
   * vrai stack prouve la chaîne entière : client provisionné par le BFF avec la bonne adresse,
   * outbox, job, gabarit rendu. Le code dans le corps relie l'e-mail à CETTE réservation (adresse
   * propre au passage, aucune écriture en base).
   */
  const reservationCode = (await code.innerText()).trim();
  const confirmation = await lastMail({ to: email });
  expect(confirmation.to).toContain(email.toLowerCase());
  expect(confirmation.subject).toMatch(
    /demande de réservation|booking request/i,
  );
  expect(confirmation.text).toContain(reservationCode);

  expect(failures, `Erreurs console/réseau: ${failures.join(" | ")}`).toEqual(
    [],
  );
});

test("Double soumission contre le vrai stack : une seule réservation créée (idempotence)", async ({
  page,
}) => {
  const failures = watchForFailures(page, PAYMENT_PROBE);
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
 * ⚠️ Un seul séjour est réellement réservé (`uniqueStayOffset(2)`, propre au passage : #146). L'URL
 * divergente ne fait que **relire** cette réservation sous un autre nombre de voyageurs : aucune
 * seconde chambre n'est immobilisée.
 */
test("Réservation d’un autre séjour : divergence détectée contre le vrai PMS", async ({
  page,
}) => {
  const failures = watchForFailures(page, PAYMENT_PROBE);
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
  const failures = watchForFailures(page, PAYMENT_PROBE);
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

/**
 * Upsell de services contre le vrai stack (story 2.6, FR-11 / dépendance D6).
 *
 * Ce que seul ce niveau prouve :
 * - que le catalogue servi par `GET /booking/services` vient réellement du PMS, avec le **JWT
 *   `Customer` en custody** — l'e2e isolé mocke le BFF et ne peut pas vérifier l'autorisation ;
 * - que le corps de création portant `services[]` est **accepté** par le PMS (dates de service
 *   ancrées UTC : une date-only y produit un 500) ;
 * - que le **grand total** persisté par le PMS est bien celui affiché avant la création — la
 *   garantie « le total affiché est le total débité » avec de vrais montants et une vraie devise.
 *
 * ⚠️ **Tolérant à l'absence de service.** Le seed de dev ne garantit aucun `HotelService` actif et
 * `IsExternallyBookable` : sans lui, la section d'upsell ne se rend pas — c'est le comportement
 * correct, pas un échec. Le test valide alors le chemin « sans service » (le corps de création ne
 * doit porter AUCUNE clé `services`) et signale l'absence de données. Pour couvrir le parcours
 * complet, créer un service via le back-office Manager (:3000) avant de rejouer.
 */
test("Upsell de services contre le vrai PMS : catalogue, panier accepté, total combiné", async ({
  page,
}) => {
  const failures = watchForFailures(page, PAYMENT_PROBE);
  const createBodies: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/api/v1/booking/reservations")
    ) {
      createBodies.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
    }
  });

  // La réponse du catalogue est attendue AVANT toute décision : `count()` ne patiente pas, et
  // l'appel part au montage de l'étape. Sans cette attente, le test empruntait systématiquement
  // le chemin « aucun service » — il passait, mais ne prouvait rien de l'upsell.
  const catalogResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/booking/services") && res.status() === 200,
    { timeout: 30_000 },
  );

  await goToPayment(
    page,
    `upsell-${Date.now()}@example.com`,
    uniqueStayOffset(4),
  );

  await catalogResponse;

  const upsell = page.getByTestId("service-upsell");
  const hasServices = (await upsell.count()) > 0;

  if (hasServices) {
    const toggle = upsell.getByRole("checkbox").first();

    // Opt-in strict, avec de vraies données : rien n'est coché à l'arrivée (UX-DR-9.7).
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(page.getByTestId("upsell-subtotal")).not.toContainText(
      "Aucun service",
    );
  }

  await page.getByTestId("payment-create-cta").click();
  await expect(page.getByTestId("payment-reservation-code")).toBeVisible({
    timeout: 30_000,
  });

  expect(createBodies).toHaveLength(1);

  if (hasServices) {
    // Le panier a réellement traversé la frontière jusqu'au PMS.
    expect(createBodies[0]).toHaveProperty("services");
    await expect(page.getByTestId("payment-attached-services")).toBeVisible();
  } else {
    // Aucun service disponible : le corps doit être byte-pour-byte celui d'avant D6 (AC-9).
    expect(createBodies[0]).not.toHaveProperty("services");
    console.warn(
      "[smoke 2.6] Aucun HotelService actif et vendable dans le seed — parcours d'upsell non couvert.",
    );
  }

  // ⚠️ La garantie « total affiché = total débité » se vérifie contre le total **soumis**
  // (`expectedTotal`, chambre + services), et NON contre `booking-total`, qui reste la chambre
  // seule : le récapitulatif précède l'étape d'upsell. Comparer au total chambre faisait échouer
  // le test dès qu'un service était ajouté — pour une divergence qui n'existait pas.
  const submitted = createBodies[0].expectedTotal as number;
  const persisted = await page
    .getByTestId("payment-reservation-total")
    .innerText();
  const persistedMinor = Math.round(
    Number(persisted.replace(/[^\d.,]/g, "").replace(",", ".")) * 100,
  );
  expect(persistedMinor).toBe(submitted);

  expect(failures).toEqual([]);
});

/**
 * Scénarios qui dépendent du **vrai Stripe** (mode test) : marqués `@external` (#94, #125 AC-4). Un
 * échec réseau vers Stripe y est classé « externe » par `scripts/smoke-baseline.mjs` (relancé une
 * fois, signalé, non bloquant) ; tout autre échec, ou un échec vers le stack local, reste une
 * régression.
 */
const STRIPE_EXTERNAL = {
  tag: "@external",
  annotation: {
    type: "external",
    description: "Stripe (js.stripe.com, api.stripe.com, mode test)",
  },
};

/**
 * Story 3.1 — **autorisation carte réelle** contre le vrai stack et le vrai Stripe (mode test).
 *
 * Ce que ni l'e2e isolé ni les tests d'intégration ne peuvent prouver :
 * - que le PMS crée bien un PaymentIntent en **capture manuelle** — l'intent atteint le statut
 *   `requires_capture`, et **rien n'est encaissé** ;
 * - que le `clientSecret` relayé par le BFF est réellement exploitable par Stripe.js (un jeton
 *   mal formé ou périmé ne se voit qu'ici) ;
 * - que la confirmation se résout **sans quitter le tunnel** (`redirect: "if_required"`) ;
 *
 * ⚠️ Ce scénario N'EXERCE PAS la 3-D Secure : il utilise la carte `4242…`, qui n'en déclenche
 * aucune. La carte 3-DS (`4000 0025 0000 3155`) ouvre une modale hébergée par Stripe dont
 * l'automatisation est fragile ; la branche `requires_action` est couverte en test d'intégration
 * (mock de `confirmPayment`). L'affirmation contraire figurait ici avant la revue de code 3.1 —
 * c'était une sur-déclaration.
 * - qu'après autorisation, l'écran n'annonce **jamais** une réservation confirmée (AC-8).
 *
 * ⚠️ Ce test place une vraie autorisation sur une carte de test Stripe. Elle n'est jamais capturée
 * (c'est le périmètre de la story 3.2) et expire d'elle-même sous ~7 jours.
 */
test(
  "Paiement carte contre le vrai Stripe : autorisation sans capture, sans quitter le tunnel",
  STRIPE_EXTERNAL,
  async ({ page }) => {
    // Budget élargi : ce scénario enchaîne de vrais aller-retours réseau avec Stripe (chargement de
    // js.stripe.com, montage du Payment Element, confirmation, sonde de statut). Les 30 s par défaut
    // suffisent aux scénarios qui ne parlent qu'au stack local, pas à celui-ci.
    test.setTimeout(150_000);
    const failures = watchForFailures(page, PAYMENT_PROBE);
    const email = `smoke-pay-${Date.now()}@example.com`;

    await goToPayment(page, email, paidStayOffset(0));

    const cta = page.getByTestId("payment-create-cta");
    await expect(cta).toBeEnabled({ timeout: 20_000 });
    await cta.click();

    await expect(page.getByTestId("payment-reservation-code")).toBeVisible({
      timeout: 20_000,
    });

    // Le formulaire n'apparaît qu'une fois l'intent obtenu du BFF **et** Stripe.js chargé.
    const form = page.getByTestId("payment-form");
    await expect(form).toBeVisible({ timeout: 30_000 });

    // AC-1 : la promesse « aucun débit ferme » est portée par le `captureMethod` renvoyé par le PMS.
    // Si le PaymentIntent n'était pas en capture manuelle, ce bloc disparaîtrait au lieu de mentir.
    await expect(page.getByTestId("payment-no-firm-debit")).toBeVisible();

    // Saisie de la carte de test dans l'iframe Stripe. Le Payment Element expose un seul champ
    // combiné ; on le remplit par saisie clavier plutôt que par sélecteurs internes (instables).
    await fillTestCard(page);

    await submitPayment(page);

    // AC-3 : l'autorisation aboutit **sur la page** (`redirect: "if_required"`).
    const authorized = page.getByTestId("payment-authorized");
    await expect(authorized).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/booking\/payment\?/);

    // AC-8 : autorisé n'est PAS confirmé. Aucun code de confirmation, aucun QR, aucun PDF, aucune
    // promesse d'e-mail — c'est le périmètre de la story 3.2. Défaut réel trouvé en Phase 3 de 2.3.
    await expect(authorized).not.toContainText(/confirmée|e-?mail|QR|PDF/i);

    // La réservation reste `Pending` : seule la confirmation la fera basculer.
    await expect(page.getByTestId("payment-reservation-panel")).toHaveAttribute(
      "data-status",
      "Pending",
    );

    // Le formulaire a disparu : reproposer de payer une carte déjà autorisée serait le chemin du
    // double débit (AC-6).
    await expect(page.getByTestId("payment-submit")).toHaveCount(0);

    expect(failures, `échecs console/réseau : ${failures.join(" | ")}`).toEqual(
      [],
    );
  },
);

/**
 * Story 3.1 / AC-6 — un rechargement après autorisation ne repropose jamais de payer.
 *
 * L'écran doit relire l'état réel de l'intent chez Stripe (`requires_capture`) et rendre l'état
 * « autorisé », et non un formulaire vierge. Le PMS, de son côté, refuse d'émettre un second intent.
 */
test(
  "Rechargement après autorisation : aucune seconde invitation à payer",
  STRIPE_EXTERNAL,
  async ({ page }) => {
    test.setTimeout(150_000);
    const email = `smoke-pay2-${Date.now()}@example.com`;

    await goToPayment(page, email, paidStayOffset(1));
    await page.getByTestId("payment-create-cta").click();
    await expect(page.getByTestId("payment-reservation-code")).toBeVisible({
      timeout: 20_000,
    });

    const form = page.getByTestId("payment-form");
    await expect(form).toBeVisible({ timeout: 30_000 });

    await fillTestCard(page);
    await submitPayment(page);

    await expect(page.getByTestId("payment-authorized")).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();

    // Après rechargement : toujours autorisé, jamais un nouveau formulaire de paiement.
    await expect(page.getByTestId("payment-authorized")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("payment-submit")).toHaveCount(0);
  },
);
