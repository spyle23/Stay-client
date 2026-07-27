"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useLogout, useSession } from "@/hooks/use-session";

/**
 * Espace client — **coquille minimale** (story 2.1). L'espace complet (mes réservations,
 * détail, annulation) arrive en Epic 4 : cette page ne sert ici qu'à prouver le cycle de vie
 * de la session (identité affichée + déconnexion) et à porter la garde côté client.
 *
 * ⚠️ Double garde volontaire (AC-10) : `proxy.ts` ne teste que la **présence** du cookie
 * (il n'a pas le secret et ne parle pas à Redis) ; la **validité** est tranchée par le BFF.
 * Un cookie périmé/forgé arrive donc jusqu'ici → on redirige vers la connexion.
 */
export default function AccountPage() {
  const t = useTranslations("account");
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending, isError, refetch } = useSession();
  const logout = useLogout();
  const [logoutError, setLogoutError] = useState(false);

  const authenticated = session?.authenticated ?? false;
  // Une déconnexion volontaire rend forcément `authenticated` faux : sans cette garde, l'effet
  // de redirection ci-dessous courrait contre la navigation du bouton et gagnait — l'utilisateur
  // atterrissait sur /login au lieu de l'accueil. Pendant une déconnexion, c'est le handler
  // du bouton qui pilote la navigation.
  const loggingOut = logout.isPending || logout.isSuccess;

  useEffect(() => {
    // `isError` : une panne du BFF (ou un simple hoquet réseau) n'est PAS une absence de session.
    // Éjecter dans ce cas déconnecterait un utilisateur parfaitement valide — exactement ce que
    // le serveur prend soin d'éviter en conservant la session sur `PmsUnavailableError`.
    if (!isPending && !isError && !authenticated && !loggingOut) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isPending, isError, authenticated, loggingOut, pathname, router]);

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <p className="text-body text-muted-foreground">{t("loading")}</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-4 px-4 py-10">
        <p
          role="alert"
          data-testid="account-error"
          className="text-body text-foreground"
        >
          {t("unavailable")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-(--tap-min)"
          data-testid="account-retry"
          onClick={() => void refetch()}
        >
          {t("retry")}
        </Button>
      </main>
    );
  }

  if (!authenticated) {
    // Redirection en cours : aucun contenu de compte ne doit clignoter à l'écran.
    // Pendant une déconnexion volontaire, le message annonce la sortie, pas une reconnexion.
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <p className="text-body text-muted-foreground">
          {loggingOut ? t("logoutPending") : t("redirecting")}
        </p>
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10"
      data-testid="account-page"
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-h1 text-foreground">{t("title")}</h1>
        <p className="text-body text-muted-foreground">
          {t("signedInAs", { email: session?.user?.email ?? "" })}
        </p>
      </header>

      <p className="text-small text-muted-foreground">{t("comingSoon")}</p>

      {logoutError && (
        <p
          role="alert"
          data-testid="logout-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-small text-destructive"
        >
          {t("logoutError")}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        className="min-h-(--tap-min) w-full sm:w-auto"
        disabled={logout.isPending}
        data-testid="logout-button"
        onClick={() => {
          setLogoutError(false);
          logout.mutate(undefined, {
            onSuccess: () => {
              router.replace("/");
              // Réévalue la garde `proxy.ts` côté serveur (le cookie a été expiré).
              router.refresh();
            },
            // Sans ce retour, un échec (BFF/Redis indisponible) laissait l'utilisateur croire
            // qu'il s'était déconnecté — le pire scénario sur un poste partagé.
            onError: () => setLogoutError(true),
          });
        }}
      >
        {logout.isPending ? t("logoutPending") : t("logout")}
      </Button>
    </main>
  );
}
