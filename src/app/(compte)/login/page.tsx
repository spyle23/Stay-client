import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/organisms/login-form";
import { safeInternalPath } from "@/lib/safe-redirect";

/**
 * Page de connexion (story 2.1 — FR-19). URL publique `/login` (le groupe `(compte)` ne
 * segmente pas l'URL), volontairement **hors** du matcher de `proxy.ts` : la garder
 * provoquerait une boucle de redirection.
 *
 * ⚠️ Next 16 : `searchParams` est une **Promise** (à `await`).
 *
 * `noindex` : une page de connexion n'a aucune valeur SEO et ne doit pas capter de trafic.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  // Garde anti open-redirect : seul un chemin interne est accepté.
  const next = safeInternalPath(rawNext);
  const t = await getTranslations("auth");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-h1 text-foreground">{t("title")}</h1>
        <p className="text-body text-muted-foreground">{t("subtitle")}</p>
      </header>
      <LoginForm next={next} />
    </main>
  );
}
