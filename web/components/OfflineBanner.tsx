"use client";
import { useCallback, useEffect, useState } from "react";
import { flushQueue, listQueue, onQueueChange, discardFailed, isOffline, registerServiceWorker } from "@/lib/offline";

// A slim status bar that appears only when offline or when writes are queued.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [synced, setSynced] = useState<number | null>(null);

  const refreshCounts = useCallback(async () => {
    const q = await listQueue();
    setPending(q.filter((i) => i.status === "pending").length);
    setFailed(q.filter((i) => i.status === "failed").length);
  }, []);

  useEffect(() => {
    registerServiceWorker();
    setOffline(isOffline());
    refreshCounts();

    const goOnline = () => { setOffline(false); flushQueue().then(refreshCounts); };
    const goOffline = () => setOffline(true);
    const onQueue = () => refreshCounts();
    const onSync = (e: Event) => {
      const n = (e as CustomEvent).detail?.synced ?? 0;
      if (n > 0) { setSynced(n); setTimeout(() => setSynced(null), 6000); }
      refreshCounts();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("hfos-sync", onSync);
    const off = onQueueChange(refreshCounts);
    // Attempt a flush on mount in case we reloaded with items still queued.
    if (!isOffline()) flushQueue().then(refreshCounts);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("hfos-sync", onSync);
      off();
    };
  }, [refreshCounts]);

  const nothingToShow = !offline && pending === 0 && failed === 0 && synced === null;
  if (nothingToShow) return null;

  let tone = "border-warning/40 bg-warning/10 text-warning";
  let message = "";
  let action: React.ReactNode = null;

  if (offline) {
    tone = "border-warning/40 bg-warning/10 text-warning";
    message = pending > 0
      ? `You're offline — ${pending} change${pending === 1 ? "" : "s"} will sync when you reconnect.`
      : "You're offline — showing your last synced data. Changes will queue until you're back online.";
  } else if (failed > 0) {
    tone = "border-negative/40 bg-negative/10 text-negative";
    message = `${failed} change${failed === 1 ? "" : "s"} couldn't sync (a conflict or validation error).`;
    action = (
      <button onClick={() => discardFailed().then(refreshCounts)} className="ml-2 rounded-md border border-current px-2 py-0.5 text-xs font-medium hover:opacity-80">
        Discard
      </button>
    );
  } else if (pending > 0) {
    tone = "border-info/40 bg-info/10 text-info";
    message = `Syncing ${pending} change${pending === 1 ? "" : "s"}…`;
  } else if (synced !== null) {
    tone = "border-positive/40 bg-positive/10 text-positive";
    message = `Synced ${synced} change${synced === 1 ? "" : "s"}.`;
    action = (
      <button onClick={() => window.location.reload()} className="ml-2 rounded-md border border-current px-2 py-0.5 text-xs font-medium hover:opacity-80">
        Refresh
      </button>
    );
  }

  return (
    <div role="status" className={`flex items-center justify-center gap-1 border-b px-4 py-1.5 text-center text-xs font-medium ${tone}`}>
      <span aria-hidden>{offline ? "⚠" : failed > 0 ? "!" : synced !== null ? "✓" : "⟳"}</span>
      <span>{message}</span>
      {action}
    </div>
  );
}
