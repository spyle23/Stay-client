import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AccountPage from "@/app/(compte)/account/page";
import frMessages from "@/i18n/messages/fr.json";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/account",
}));

const SESSION_USER = {
  userId: "u-1",
  email: "voyageur@example.com",
  firstName: "Rakoto",
  lastName: null,
};

interface RouteStub {
  status?: number;
  body: unknown;
}

/** Aiguille `fetch` : GET → état de session, POST → déconnexion. */
function stubFetch(routes: { session?: RouteStub; logout?: RouteStub }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const route =
        (init?.method ?? "GET") === "POST"
          ? (routes.logout ?? { body: { success: true, data: null } })
          : (routes.session ?? {
              body: {
                success: true,
                data: { authenticated: true, user: SESSION_USER },
              },
            });
      const status = route.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(route.body),
      });
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // `useSession` impose `retry: 1` : sans `retryDelay: 0`, le backoff retarderait l'état
      // d'erreur au-delà du budget des `waitFor`.
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <QueryClientProvider client={queryClient}>
        <AccountPage />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("AccountPage (intégration)", () => {
  beforeEach(() => {
    replace.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("affiche l’identité de la session", async () => {
    stubFetch({});
    renderPage();

    expect(await screen.findByTestId("account-page")).toHaveTextContent(
      "voyageur@example.com",
    );
  });

  it("redirige vers la connexion en conservant la cible quand la session est absente", async () => {
    stubFetch({
      session: {
        body: { success: true, data: { authenticated: false, user: null } },
      },
    });
    renderPage();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?next=%2Faccount"),
    );
  });

  it("NE redirige PAS sur une panne du BFF — elle propose de réessayer", async () => {
    // Régression : traiter une erreur de lecture comme « non authentifié » déconnectait un
    // utilisateur valide au moindre hoquet réseau, à rebours de ce que le serveur garantit.
    stubFetch({ session: { status: 503, body: { success: false } } });
    renderPage();

    expect(await screen.findByTestId("account-error")).toHaveTextContent(
      frMessages.account.unavailable,
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("déconnexion réussie → retour à l’accueil, PAS vers /login (régression Phase 3)", async () => {
    // Le correctif issu de la vérification navigateur : sans la garde `loggingOut`, l'effet de
    // redirection de cette page gagnait la course contre la navigation du bouton.
    stubFetch({});
    renderPage();
    fireEvent.click(await screen.findByTestId("logout-button"));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalledWith("/login?next=%2Faccount");
  });

  it("échec de déconnexion → message d’erreur explicite (poste partagé)", async () => {
    stubFetch({ logout: { status: 503, body: { success: false } } });
    renderPage();
    fireEvent.click(await screen.findByTestId("logout-button"));

    expect(await screen.findByTestId("logout-error")).toHaveTextContent(
      frMessages.account.logoutError,
    );
    // L'utilisateur reste sur la page : on ne lui fait pas croire qu'il est sorti.
    expect(replace).not.toHaveBeenCalledWith("/");
  });
});
