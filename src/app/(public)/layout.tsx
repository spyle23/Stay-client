import type { ReactNode } from "react";

import { SiteHeader } from "@/components/organisms/site-header";

// Layout des surfaces publiques (accueil, recherche, fiches) : ajoute le header
// léger (sélecteurs langue/devise + thème). Les providers i18n/thème/devise sont
// posés une seule fois dans le layout racine.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
