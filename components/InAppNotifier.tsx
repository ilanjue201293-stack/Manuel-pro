"use client";

import { useEffect, useRef, useState } from "react";

type ToastPayload = {
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
      setToast({
        title: typeof payload.title === "string" ? payload.title : "Nouveau message",
        body: typeof payload.body === "string" ? payload.body : "Tu as reçu un nouveau message.",
        url: typeof payload.url === "string" ? payload.url : undefined,
        conversationId: typeof payload.conversationId === "string" ? payload.conversationId : undefined,
      });

      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), 4500);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  function openConversation() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const target = toast?.url || (toast?.conversationId ? `/?conversation=${encodeURIComponent(toast.conversationId)}` : "/");
    setToast(null);
    if (target) window.location.assign(target);
  }

  return (
    <div className="in-app-toast" role="status" aria-live="polite">
      <button className="in-app-toast-main" onClick={openConversation}>
        <span className="in-app-toast-icon">M</span>
        <span className="in-app-toast-copy">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </span>
      </button>
      <button className="in-app-toast-close" aria-label="Fermer" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
