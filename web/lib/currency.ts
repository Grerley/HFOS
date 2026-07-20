"use client";
import { createContext, useContext } from "react";

// The active household's base currency, provided by AppShell so every page
// formats money in the household's real currency instead of a hard-coded "ZAR".
export const CurrencyContext = createContext<string>("ZAR");

export function useCurrency(): string {
  return useContext(CurrencyContext);
}
