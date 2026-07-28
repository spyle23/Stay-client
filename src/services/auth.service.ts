import { api, ApiClientError } from "@/lib/api-client";

/**
 * Service du domaine `auth` (story 2.1 — FR-19 / AR-9 / NFR-8). Appelle **le BFF**, jamais le PMS.
 *
 * Modèle de session : le navigateur ne détient qu'un **cookie opaque HttpOnly** posé par le BFF
 * (envoyé grâce à `credentials: "include"` de l'`api-client`). Aucun jeton n'est lu, stocké ni
 * décodé ici — c'est l'invariant central de l'architecture cliente.
 *
 * ⚠️ Chemins **relatifs au BFF** : `API_BASE_URL` contient déjà `/api/v1`. Ne pas recopier les
 * chemins PMS de `Stay/src/services/auth.service.ts` (back-office) — le front cliente ne parle
 * jamais au PMS.
 */

export const AUTH_ENDPOINTS = {
  login: "/auth/login",
  guest: "/auth/guest",
  session: "/auth/session",
  logout: "/auth/logout",
} as const;

/** Identité affichable renvoyée par le BFF (miroir de `SessionUser`). Jamais de jeton. */
export interface SessionUser {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** État de session (miroir de `SessionStateDto`). */
export interface SessionState {
  authenticated: boolean;
  user: SessionUser | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export const ANONYMOUS_SESSION: SessionState = {
  authenticated: false,
  user: null,
};

/** Clés React Query du domaine (convention `["domaine", "sous-clé"]`). */
export const authKeys = {
  session: ["auth", "session"] as const,
};

/**
 * Lit l'état de session. Le BFF répond **200 même anonyme** : une erreur ici signale une vraie
 * panne (BFF injoignable), pas une absence de session.
 */
export async function fetchSession(): Promise<SessionState> {
  return api.get<SessionState>(AUTH_ENDPOINTS.session);
}

export async function login(
  credentials: LoginCredentials,
): Promise<SessionState> {
  return api.post<SessionState>(AUTH_ENDPOINTS.login, credentials);
}

/**
 * Coordonnées du **Checkout invité** (story 2.3 — FR-8). Aucun mot de passe : le BFF provisionne
 * le compte léger avec un secret généré côté serveur, que le navigateur ne voit jamais.
 */
export interface GuestCheckoutInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}

/**
 * Provisionne (ou réutilise) l'identité invité et ouvre la session.
 *
 * Le contrat de réponse est **identique** à `login` : un seul modèle de session côté front.
 * `409` = un compte existe déjà avec cet email → inviter à se connecter (FR-8), jamais créer
 * un doublon silencieux.
 */
export async function provisionGuest(
  input: GuestCheckoutInput,
): Promise<SessionState> {
  return api.post<SessionState>(AUTH_ENDPOINTS.guest, input);
}

/**
 * Le BFF réserve **409** à la collision d'email. Tout autre 4xx est une saisie refusée : les
 * confondre enverrait le voyageur se connecter à un compte qui n'existe pas.
 */
export function isEmailConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409;
}

/**
 * Déconnexion. Un **401 est traité comme un succès** : la session visée n'existe déjà plus
 * (expirée, révoquée ailleurs) — l'utilisateur a demandé à sortir, on ne lui montre pas d'erreur.
 */
export async function logout(): Promise<void> {
  try {
    await api.post<SessionState>(AUTH_ENDPOINTS.logout);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return;
    }
    throw error;
  }
}
