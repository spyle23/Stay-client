import { useTranslations } from "next-intl";

import { SearchBar } from "@/components/organisms/search-bar";

// Accueil (SSR) — promesse « availability-first » + SearchBar hero (Story 1.6, FR-1) avec le
// déclencheur « Autour de moi » (géoloc, Story 1.7, FR-2). Textes i18n (fr/en) via next-intl ;
// tokens du design-system (aucune valeur en dur).
export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <section className="flex flex-col items-center gap-3 rounded-2xl bg-primary-soft/40 px-4 py-12 text-center">
        <h1 className="max-w-2xl text-display text-foreground">{t("title")}</h1>
        <p
          data-testid="home-subtitle"
          className="max-w-xl text-body text-muted-foreground"
        >
          {t("subtitle")}
        </p>
      </section>

      <div className="mx-auto w-full max-w-4xl">
        <SearchBar variant="hero" geolocationEnabled />
      </div>
    </main>
  );
}
