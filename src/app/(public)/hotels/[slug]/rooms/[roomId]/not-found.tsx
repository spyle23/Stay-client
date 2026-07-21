import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button";

/**
 * 404 de la fiche chambre (slug/roomId sans GUID valide, ou chambre introuvable au PMS). Rendue par
 * `notFound()` de `page.tsx`. Sans ce fichier, Next servirait sa 404 par défaut — en anglais, non stylée.
 */
export default async function RoomNotFound() {
  const t = await getTranslations("hotel");
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
      <div
        data-testid="room-not-found"
        className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
      >
        <SearchXIcon
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="text-h3 text-foreground">{t("roomNotFoundTitle")}</h1>
        <p className="max-w-md text-body text-muted-foreground">
          {t("roomNotFoundBody")}
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("notFoundCta")}
        </Link>
      </div>
    </main>
  );
}
