/**
 * Garde **anti open-redirect** pour le paramètre `?next=` (story 2.1).
 *
 * Un `next` non validé permettrait `/login?next=https://evil.example` : après connexion, le
 * voyageur serait envoyé sur un site tiers depuis un lien qui *semble* légitime (hameçonnage).
 *
 * Seuls les chemins **internes absolus** sont acceptés :
 * - doivent commencer par `/` ;
 * - `//evil.com` et `/\evil.com` sont rejetés (URL protocol-relative interprétée comme externe) ;
 * - toute valeur portant un schéma (`http:`, `javascript:`…) est rejetée ;
 * - les caractères de contrôle sont rejetés (ils trompent les parseurs d'URL).
 */
export const DEFAULT_REDIRECT = "/account";

/**
 * Destinations refusées même si internes : renvoyer sur la connexion après s'être connecté
 * produit un aller-retour parasite (et une boucle si `/login` rejoignait le matcher du proxy).
 */
const BLOCKED_PREFIXES = ["/login"];

/** Caractères de contrôle C0 + DEL, interdits dans un chemin de redirection. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function safeInternalPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  if (!value.startsWith("/")) {
    return fallback;
  }
  // `//host` et `/\host` sont des URL protocol-relative → destination EXTERNE.
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  if (hasControlChar(value)) {
    return fallback;
  }
  if (
    BLOCKED_PREFIXES.some(
      (prefix) =>
        value === prefix ||
        value.startsWith(`${prefix}?`) ||
        value.startsWith(`${prefix}/`),
    )
  ) {
    return fallback;
  }
  return value;
}
