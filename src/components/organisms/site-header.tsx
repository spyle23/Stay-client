import Link from "next/link";
import { useTranslations } from "next-intl";

import { CurrencySwitcher } from "@/components/atoms/currency-switcher";
import { LocaleSwitcher } from "@/components/atoms/locale-switcher";
import { ThemeToggle } from "@/components/atoms/theme-toggle";

/**
 * Header léger et collant des surfaces publiques : marque à gauche, contrôles à
 * droite (devise · langue · thème). Hôte des sélecteurs de la Story 1.5 — la
 * navigation complète (liens, compte) arrive avec les pages dédiées. Server
 * component : `useTranslations` est supporté en RSC ; les sélecteurs sont des
 * client components rendus ici.
 */
export function SiteHeader() {
  const t = useTranslations("header");

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
      <nav
        aria-label={t("navLabel")}
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <Link
          href="/"
          className="text-h3 font-bold tracking-tight text-foreground"
        >
          Hotel<span className="text-primary">erie</span>
        </Link>
        <div className="flex items-center gap-2">
          <CurrencySwitcher />
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
