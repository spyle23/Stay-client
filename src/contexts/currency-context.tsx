"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setBrowserCookie } from "@/lib/cookies";
import { CURRENCY_COOKIE, type Currency } from "@/lib/currency";

type CurrencyContextValue = {
  /** Devise de travail active (segmentation mono-devise, aucune conversion). */
  currency: Currency;
  /** Change la devise de travail : persiste le cookie + met à jour l'état. */
  setCurrency: (currency: Currency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

/**
 * Fournit la devise de travail. `initialCurrency` est calculée côté serveur
 * (cookie `WORKING_CURRENCY`, sinon défaut région/langue) et injectée au layout,
 * garantissant une hydratation SSR cohérente (pas de mismatch). Le changement de
 * devise ne recharge pas la page : il n'affecte que les paramètres de recherche,
 * consommés par les stories de recherche (1.6/1.8).
 */
export function CurrencyProvider({
  initialCurrency,
  children,
}: {
  initialCurrency: Currency;
  children: ReactNode;
}) {
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);

  const setCurrency = useCallback((next: Currency) => {
    setBrowserCookie(CURRENCY_COOKIE, next);
    setCurrencyState(next);
  }, []);

  const value = useMemo(
    () => ({ currency, setCurrency }),
    [currency, setCurrency],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (context === null) {
    throw new Error(
      "useCurrency doit être utilisé dans un <CurrencyProvider>.",
    );
  }
  return context;
}
