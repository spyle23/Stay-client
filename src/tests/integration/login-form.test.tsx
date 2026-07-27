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

import { LoginForm } from "@/components/organisms/login-form";
import frMessages from "@/i18n/messages/fr.json";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
}));

interface RouteStub {
  status?: number;
  body: unknown;
}

/** Aiguille les appels `fetch` par méthode + chemin (session / login). */
function stubFetch(routes: { session?: RouteStub; login?: RouteStub }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const route =
      method === "POST" && url.includes("/auth/login")
        ? (routes.login ?? { body: { success: false }, status: 500 })
        : (routes.session ?? {
            body: { success: true, data: { authenticated: false, user: null } },
          });
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(route.body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderForm(next = "/account") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <QueryClientProvider client={queryClient}>
        <LoginForm next={next} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByTestId("login-submit"));
}

describe("LoginForm (intégration)", () => {
  beforeEach(() => {
    replace.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("bloque la soumission et affiche les erreurs i18n sans appeler le BFF", async () => {
    const fetchMock = stubFetch({});
    renderForm();

    submit();

    // Les DEUX champs vides sont signalés (email + mot de passe).
    expect(
      await screen.findAllByText(frMessages.validation.required),
    ).toHaveLength(2);
    // Aucun POST de connexion : la validation front a court-circuité l'appel.
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(0);
    expect(screen.getByTestId("login-email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("associe le message d’erreur au champ (aria-describedby + role=alert) — WCAG 2.1 AA", async () => {
    stubFetch({});
    renderForm();

    fill("login-email", "pas-un-email");
    fill("login-password", "secret123");
    submit();

    const email = screen.getByTestId("login-email");
    await waitFor(() =>
      expect(email).toHaveAttribute("aria-describedby", expect.any(String)),
    );
    const describedBy = email.getAttribute("aria-describedby") as string;
    const errorNode = document.getElementById(describedBy);
    expect(errorNode?.textContent).toBe(frMessages.validation.emailInvalid);
    expect(errorNode).toHaveAttribute("role", "alert");
  });

  it("connexion réussie → redirection vers la destination demandée", async () => {
    stubFetch({
      login: {
        body: {
          success: true,
          data: {
            authenticated: true,
            user: {
              userId: "u-1",
              email: "voyageur@example.com",
              firstName: "Rakoto",
              lastName: null,
            },
          },
        },
      },
    });
    renderForm("/account/reservations");

    fill("login-email", "voyageur@example.com");
    fill("login-password", "secret123");
    submit();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/account/reservations"),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("identifiants invalides → message GÉNÉRIQUE i18n (jamais le texte du PMS)", async () => {
    stubFetch({
      login: {
        status: 400,
        body: { success: false, message: "Invalid email or password." },
      },
    });
    renderForm();

    fill("login-email", "voyageur@example.com");
    fill("login-password", "mauvaispass");
    submit();

    const error = await screen.findByTestId("login-error");
    expect(error).toHaveTextContent(frMessages.auth.errorInvalidCredentials);
    // Anti-énumération : le message du PMS ne doit pas transparaître.
    expect(error.textContent).not.toContain("Invalid email or password");
    expect(replace).not.toHaveBeenCalled();
  });

  it("compte non-voyageur (403) → message dédié", async () => {
    stubFetch({
      login: { status: 403, body: { success: false, message: "forbidden" } },
    });
    renderForm();

    fill("login-email", "manager@example.com");
    fill("login-password", "secret123");
    submit();

    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      frMessages.auth.errorForbiddenRole,
    );
  });

  it("BFF/PMS indisponible (503) → message de dégradation explicite", async () => {
    stubFetch({
      login: { status: 503, body: { success: false, message: "down" } },
    });
    renderForm();

    fill("login-email", "voyageur@example.com");
    fill("login-password", "secret123");
    submit();

    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      frMessages.auth.errorUnavailable,
    );
  });

  it("déjà connecté → redirection immédiate, sans formulaire à remplir", async () => {
    stubFetch({
      session: {
        body: {
          success: true,
          data: {
            authenticated: true,
            user: {
              userId: "u-1",
              email: "voyageur@example.com",
              firstName: null,
              lastName: null,
            },
          },
        },
      },
    });
    renderForm("/account");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
  });
});
