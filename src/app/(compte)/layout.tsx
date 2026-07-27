import type { ReactNode } from "react";

import { SiteHeader } from "@/components/organisms/site-header";

/**
 * Layout des surfaces de compte (connexion, espace client — story 2.1).
 *
 * Reprend le **header léger** des surfaces publiques (sélecteurs langue/devise + thème, retour
 * à l'accueil) : sans lui, `/login` et `/account` seraient des culs-de-sac sans navigation ni
 * bascule de langue (UX-DR-7.12, UX-DR-8.1). Les providers i18n/thème/devise restent posés une
 * seule fois dans le layout racine.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
