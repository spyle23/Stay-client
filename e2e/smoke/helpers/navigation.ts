import { expect, test, type Page } from "@playwright/test";

import { watchRscActivity, type RscIdleOptions } from "./rsc-idle";

/**
 * Clique sur le `index`-ième élément `testId` une fois les préchargements RSC calmés, puis exige
 * l'URL attendue (#125, contournement suivi par #148).
 *
 * 1. suit les requêtes RSC du front dès l'appel (juste après la navigation qui affiche les liens) ;
 * 2. attend l'élément visible (20 s) ;
 * 3. attend le calme des préchargements `_rsc=` (≈ 300 ms, borne 10 s, sans échec à la borne) ;
 * 4. clique, puis exige l'URL de destination.
 *
 * Aucun rechargement ni nouvelle tentative : une page blanche reste un échec de la spec appelante.
 */
async function clickWhenRscIdle(
  page: Page,
  testId: string,
  index: number,
  destination: RegExp,
  options?: RscIdleOptions,
  missing?: string,
): Promise<void> {
  const activity = watchRscActivity(page);
  try {
    const target = page.getByTestId(testId).nth(index);
    await expect(target, missing).toBeVisible({ timeout: 20_000 });
    const idle = await activity.waitForQuiet(options);
    if (idle === "timeout") {
      // Trace dans le rapport : la borne atteinte n'est pas un échec, mais elle doit se voir.
      test.info().annotations.push({
        type: "rsc-idle",
        description: `préchargements RSC encore en cours (${activity.inFlight()}) à la borne`,
      });
    }
    await target.click();
  } finally {
    activity.dispose();
  }
  await expect(page).toHaveURL(destination);
}

/** Ouvre la fiche d'un hôtel depuis la liste de résultats (#125). */
export async function openHotelCard(
  page: Page,
  index = 0,
  options?: RscIdleOptions,
): Promise<void> {
  await clickWhenRscIdle(page, "hotel-card", index, /\/hotels\//, options);
}

/**
 * Ouvre la fiche d'une chambre depuis la fiche hôtel (#146) : même course que pour la carte
 * d'hôtel, constatée en Phase 3 (fiche chambre blanche, `room-book-cta` absent). À appeler juste
 * après `openHotelCard`, pour suivre les préchargements des liens de chambre.
 *
 * Une chambre absente nomme l'URL de la fiche : séjour déjà tenu (fenêtre de séjour non unique,
 * #146) ou fiche hôtel blanche (#148).
 */
export async function openRoomCard(
  page: Page,
  index = 0,
  options?: RscIdleOptions,
): Promise<void> {
  await clickWhenRscIdle(
    page,
    "room-card-cta",
    index,
    /\/rooms\//,
    options,
    `aucune chambre proposée sur ${page.url()}`,
  );
}
