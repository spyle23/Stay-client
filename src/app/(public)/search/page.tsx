import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SearchBar } from "@/components/organisms/search-bar";
import { SearchResults } from "@/components/organisms/search-results";
import { buttonVariants } from "@/components/ui/button";
import { parseSearchParams } from "@/lib/validations/search";

/**
 * Page de résultats (coquille **SSR** — Server Component). Valide les query-params côté
 * serveur : si invalides → état de saisie invalide **sans aucun fetch** (AC-2/AC-4). Sinon,
 * l'île client `SearchResults` charge les hôtels via le BFF (skeletons pendant le chargement).
 * L'état (destination/dates/voyageurs/devise) vit dans l'URL → partageable, rechargeable (AC-8).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("results");
  const parsed = parseSearchParams(sp);

  // Sur saisie invalide, on préremplit la barre collante avec les valeurs BRUTES de l'URL
  // (dates/voyageurs récupérables) pour ne pas forcer une re-saisie complète.
  const firstStr = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawGuests = Number(firstStr(sp.guests));
  const rawDefaults = {
    destination: firstStr(sp.destination),
    checkInDate: firstStr(sp.checkInDate),
    checkOutDate: firstStr(sp.checkOutDate),
    guests: Number.isInteger(rawGuests) ? rawGuests : undefined,
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <SearchBar
        variant="sticky"
        geolocationEnabled
        defaults={
          parsed.ok
            ? {
                // La proximité n'a pas de destination : la barre collante conserve dates/voyageurs.
                destination:
                  parsed.value.mode === "destination"
                    ? parsed.value.destination
                    : undefined,
                checkInDate: parsed.value.checkInDate,
                checkOutDate: parsed.value.checkOutDate,
                guests: parsed.value.guests,
              }
            : rawDefaults
        }
      />

      {parsed.ok ? (
        <>
          <h1 className="text-h1 text-foreground">
            {parsed.value.mode === "nearby"
              ? t("headingNearby")
              : t("headingFor", { destination: parsed.value.destination })}
          </h1>
          <SearchResults params={parsed.value} />
        </>
      ) : (
        <div
          role="alert"
          data-testid="results-invalid"
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <p className="text-h3 text-foreground">{t("invalidTitle")}</p>
          <p className="max-w-md text-body text-muted-foreground">
            {t("invalidBody")}
          </p>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            {t("invalidCta")}
          </Link>
        </div>
      )}
    </main>
  );
}
