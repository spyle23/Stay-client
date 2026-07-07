/**
 * Enveloppes de réponse génériques réexposées par le BFF — identiques au contrat PMS (AR-12).
 * camelCase ; montants en unités mineures (cents) ; dates ISO 8601 UTC ; `null` (pas `undefined`).
 *
 * Les types **métier** (Hotel, Room, Reservation…) proviennent de `@/types/generated/pms`
 * (générés depuis l'OpenAPI du PMS) — ne pas les redéfinir ici.
 */

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface ApiListResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
  message?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
