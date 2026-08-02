"use client";
import { useSyncExternalStore } from "react";

// The active household's base currency, published as a module-level store.
//
// Why not a React context? The provider previously lived *inside* AppShell, but
// every page calls useCurrency() in the component that *renders* <AppShell> — i.e.
// above the provider — so consumers only ever saw the default "ZAR", regardless of
// the household's real currency. A module store is read the same way from anywhere
// in the tree, so it sidesteps that provider-position pitfall entirely.

let current = "ZAR";
const listeners = new Set<() => void>();

/** AppShell calls this once it knows the active household's base currency. */
export function setCurrency(code: string | null | undefined) {
  const next = code || "ZAR";
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Read the active household's currency; re-renders when it changes. */
export function useCurrency(): string {
  return useSyncExternalStore(subscribe, () => current, () => "ZAR");
}
