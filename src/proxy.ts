import { NextResponse, type NextRequest } from "next/server";

/**
 * Garde des routes `(compte)` (story 2.1 — AC-10).
 *
 * **Test de présence uniquement** : le proxy ne détient pas `SESSION_SECRET` et ne parle pas à
 * Redis — il ne peut donc ni vérifier la signature du cookie, ni savoir si la session vit
 * encore. La **validité** est tranchée par le BFF ; chaque page protégée doit réagir à un
 * `authenticated:false` (cf. `(compte)/account/page.tsx`). Le rôle du proxy est d'éviter le
 * cas courant — visiteur anonyme → page de compte — sans faire d'appel réseau à chaque requête.
 *
 * ⚠️ Le nom du cookie est **figé** et doit rester aligné sur le défaut `SESSION_COOKIE_NAME` du
 * BFF. Il n'est volontairement PAS lu depuis `process.env` : cette variable est un réglage
 * **serveur du BFF**, jamais fourni au build du front. Un exploitant qui la changerait côté BFF
 * en croyant la configuration partagée provoquerait une **boucle de redirection** silencieuse
 * (`/account` → `/login` → session valide → `/account` → …), indiagnosticable côté navigateur
 * puisque le cookie est HttpOnly. Changer ce nom exige donc de modifier les deux dépôts.
 *
 * NB Next 16 : la convention `middleware` est dépréciée → renommée `proxy`.
 */
const SESSION_COOKIE = "stay_sid";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.nextUrl.origin);
  // Retour non destructif (UX-DR-4.4) : la destination initiale (chemin + query) est conservée.
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

/**
 * Limité aux routes réellement existantes. `/reservations` et `/invoices` (scaffold 1.1) ne
 * sont pas encore des routes : les rétablir dans leurs stories respectives (Epic 4 / 5).
 * `/login` n'est volontairement PAS gardé (boucle de redirection).
 */
export const config = {
  matcher: ["/account/:path*"],
};
