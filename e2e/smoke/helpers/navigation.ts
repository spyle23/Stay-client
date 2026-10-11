import { expect, type Page } from "@playwright/test";

/**
 * Clique sur le `index`-ième élément `testId` dès qu'il est visible, puis exige l'URL attendue.
 *
 * Aucune synchronisation sur les préchargements RSC (#148) : l'attente du calme des préchargements
 * ajoutée par #125 est retirée, la course qu'elle contournait étant corrigée dans le produit (cartes
 * d'hôtel et de chambre sans préchargement automatique). Ni rechargement ni nouvelle tentative : une
 * page blanche reste un échec de la spec appelante.
 */
async function clickAndExpectUrl(
  page: Page,
  testId: string,
  index: number,
  destination: RegExp,
  missing?: string,
): Promise<void> {
  const target = page.getByTestId(testId).nth(index);
  await expect(target, missing).toBeVisible({ timeout: 20_000 });
  await target.click();
  await expect(page).toHaveURL(destination);
}

/** Ouvre la fiche d'un hôtel depuis la liste de résultats. */
export async function openHotelCard(page: Page, index = 0): Promise<void> {
  await clickAndExpectUrl(page, "hotel-card", index, /\/hotels\//);
}

/**
 * Ouvre la fiche d'une chambre depuis la fiche hôtel.
 *
 * Une chambre absente nomme l'URL de la fiche : séjour déjà tenu (fenêtre de séjour non unique,
 * #146) ou fiche hôtel blanche (#148).
 */
export async function openRoomCard(page: Page, index = 0): Promise<void> {
  await clickAndExpectUrl(
    page,
    "room-card-cta",
    index,
    /\/rooms\//,
    `aucune chambre proposée sur ${page.url()}`,
  );
}
