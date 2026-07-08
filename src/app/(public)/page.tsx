import { useTranslations } from "next-intl";

// Placeholder d'accueil (SSR) — sera remplacé par la recherche multi-hôtels
// (Story 1.6). Textes internationalisés (fr/en) via next-intl ; consomme les
// tokens du design-system (aucune valeur en dur).
export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-display text-foreground">{t("title")}</h1>
      <p
        data-testid="home-subtitle"
        className="max-w-md text-body text-muted-foreground"
      >
        {t("subtitle")}
      </p>
    </main>
  );
}
