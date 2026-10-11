import { expect, test, type Page } from "@playwright/test";

import { watchRscActivity, type RscIdleOptions } from "./rsc-idle";

/**
 * Ouvre la fiche d'un hôtel depuis la liste de résultats (#125, contournement suivi par #148).
 *
 * 1. suit les requêtes RSC du front dès l'appel (juste après `page.goto`) ;
 * 2. attend la carte visible (20 s, comme avant) ;
 * 3. attend le calme des préchargements `_rsc=` (≈ 300 ms, borne 10 s, sans échec à la borne) ;
 * 4. clique, puis exige l'URL de la fiche.
 *
 * Aucun rechargement ni nouvelle tentative : une fiche blanche reste un échec de la spec appelante.
 */
export async function openHotelCard(
  page: Page,
  index = 0,
  options?: RscIdleOptions,
): Promise<void> {
  const activity = watchRscActivity(page);
  try {
    const card = page.getByTestId("hotel-card").nth(index);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const idle = await activity.waitForQuiet(options);
    if (idle === "timeout") {
      // Trace dans le rapport : la borne atteinte n'est pas un échec, mais elle doit se voir.
      test.info().annotations.push({
        type: "rsc-idle",
        description: `préchargements RSC encore en cours (${activity.inFlight()}) à la borne`,
      });
    }
    await card.click();
  } finally {
    activity.dispose();
  }
  await expect(page).toHaveURL(/\/hotels\//);
}
