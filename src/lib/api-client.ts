import type {
  ApiListResponse,
  ApiResponse,
  PaginatedResponse,
  PaginationMeta,
} from "@/types/api";

/**
 * Client HTTP du front → **BFF** (jamais le PMS directement).
 *
 * Porté de `Stay/src/lib/api-client.ts` mais **dépouillé de toute garde JWT navigateur** :
 * dans l'Application Cliente, le **BFF est gardien des jetons** (custody Redis), et le
 * navigateur ne détient qu'un **cookie de session opaque** (HttpOnly) — envoyé via
 * `credentials: "include"`. Aucun `js-cookie`, aucun refresh de jeton, aucun décodage JWT
 * au navigateur (anti-pattern proscrit par l'architecture).
 *
 * Le refresh de session (single-flight côté BFF) et la redirection login sur 401 seront
 * câblés en **story 2.1**. Ici, un 401 lève simplement `ApiClientError("Session expirée", 401)`.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  status: number;
  errors?: Record<string, string[]>;

  constructor(
    message: string,
    status: number,
    errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.errors = errors;
  }
}

type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: RequestMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

function buildInit(
  method: RequestMethod,
  body: unknown,
  headers: Record<string, string>,
): RequestInit {
  const hasBody = body !== undefined && body !== null && method !== "GET";
  const init: RequestInit = {
    method,
    headers: {
      // Content-Type seulement quand un corps JSON est réellement envoyé
      // (évite un préflight CORS inutile sur les GET).
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    // Cookie de session opaque (custody BFF) — requis pour les routes authentifiées.
    credentials: "include",
  };
  if (hasBody) {
    init.body = JSON.stringify(body);
  }
  return init;
}

/** Lit le corps JSON en tolérant un corps vide/non-JSON sur une réponse 2xx (pas de SyntaxError). */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  let message = `Request failed with status ${response.status}`;
  let details: Record<string, string[]> | undefined;
  try {
    const data = await response.json();
    if (
      Array.isArray(data.errors) &&
      data.errors.length > 0 &&
      typeof data.errors[0] === "string"
    ) {
      message = data.errors[0];
    } else if (typeof data.message === "string") {
      message = data.message;
    }
    if (data.errors && !Array.isArray(data.errors)) {
      details = data.errors;
    }
  } catch {
    // corps non-JSON : on garde le message par défaut
  }
  return new ApiClientError(message, response.status, details);
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const response = await fetch(
    `${API_BASE_URL}${endpoint}`,
    buildInit(method, body, headers),
  );

  if (response.status === 401) {
    // Custody + refresh single-flight = rôle du BFF (story 2.1). Ici : erreur explicite.
    throw new ApiClientError("Session expirée", 401);
  }
  if (!response.ok) {
    throw await toApiClientError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }

  const json = await readJsonBody(response);
  // Corps vide sur un 2xx (205, 200 sans corps) → pas de données.
  if (json === undefined || json === null) {
    return undefined as T;
  }
  // Désenveloppage ApiResponse<T> : { success, data, message?, errors? } → data
  if (typeof json === "object" && "success" in json && "data" in json) {
    return (json as ApiResponse<T>).data;
  }
  return json as T;
}

export async function apiRequestList<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<PaginatedResponse<T>> {
  const { method = "GET", body, headers = {} } = options;
  const response = await fetch(
    `${API_BASE_URL}${endpoint}`,
    buildInit(method, body, headers),
  );

  if (response.status === 401) {
    throw new ApiClientError("Session expirée", 401);
  }
  if (!response.ok) {
    throw await toApiClientError(response);
  }

  const json = (await readJsonBody(response)) as ApiListResponse<T> | undefined;
  // Corps vide/absent (204, 200 sans corps, `null`) → liste vide plutôt que SyntaxError/TypeError.
  const items: T[] = json?.data ?? [];
  const pagination: PaginationMeta = json?.pagination ?? {
    page: 1,
    pageSize: items.length,
    totalCount: items.length,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  };

  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalCount: pagination.totalCount,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
    hasPreviousPage: pagination.hasPreviousPage,
  };
}

export const api = {
  get: <T>(
    endpoint: string,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...options, method: "POST", body }),

  put: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...options, method: "PUT", body }),

  patch: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...options, method: "PATCH", body }),

  delete: <T>(
    endpoint: string,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...options, method: "DELETE" }),

  getList: <T>(
    endpoint: string,
    options?: Omit<RequestOptions, "method" | "body">,
  ) => apiRequestList<T>(endpoint, { ...options, method: "GET" }),
};
