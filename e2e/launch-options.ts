/**
 * Arguments de lancement des navigateurs Chromium de test (spyle23/hotelerie#178, suite de #177).
 *
 * Sans accélération GPU : sous la charge des runs parallèles, le GPU de la machine a provoqué un
 * écran bleu (`0x10E VIDEO_MEMORY_MANAGEMENT_INTERNAL`). Le rendu logiciel ne change pas le
 * résultat des tests (aucune capture comparée au pixel ; axe lit le DOM et les styles calculés).
 */
export const CHROMIUM_LAUNCH_ARGS: readonly string[] = ["--disable-gpu"];

/** `use.launchOptions` commun aux configs Playwright (e2e isolé, production, smoke). */
export const chromiumLaunchOptions = () => ({
  args: [...CHROMIUM_LAUNCH_ARGS],
});
