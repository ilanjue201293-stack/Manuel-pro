"use client";

import { useEffect, useRef, useState } from "react";

type ToastPayload = {
  kind?: "message" | "call";
  callType?: "audio" | "video";
  title: string;
  body: string;
  url?: string;
  conversationId?: string;
};

export default function InAppNotifier() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "MANUEL_PRO_IN_APP_PUSH") return;
      const payload = event.data.payload || {};
      const kind = payload.kind === "call" ? "call" : "message";
      setToast({
        kind,
        callType: payload.callType === "video" ? "video" : "audio",
        title: typeof payload.title === "string" ? payload.title : (kind === "call" ? "Appel entrant" : "Nouveau message"),
        body: typeof payload.body === "string" ? payload.body : (kind === "call" ? "Touchez pour répondre" : "Tu as reçu un nouveau message."),
        url: typeof payload.url === "string" ? payload.url : undefined,
        conversationId: typeof payload.conversationId === "string" ? payload.conversationId : undefined,
      });

      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), kind === "call" ? 12000 : 4500);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  function openTarget() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const target = toast?.url || (toast?.conversationId ? `/?conversation=${encodeURIComponent(toast.conversationId)}` : "/");
    setToast(null);
    if (target) window.location.assign(target);
  }

  const isCall = toast.kind === "call";
  return (
    <div className={`in-app-toast ${isCall ? "call-toast" : ""}`} role="status" aria-live="polite">
      <button className="in-app-toast-main" onClick={openTarget}>
        <span className="in-app-toast-icon">{isCall ? (toast.callType === "video" ? "▰" : "☎") : "M"}</span>
        <span className="in-app-toast-copy">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </span>
      </button>
      <button className="in-app-toast-close" aria-label="Fermer" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
