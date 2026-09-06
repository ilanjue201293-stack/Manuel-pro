"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";

type PushState = "checking" | "unsupported" | "install" | "blocked" | "off" | "on";

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0))).buffer;
}

export default function NotificationSettings() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function registration() {
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  async function refresh() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (isIosDevice() && !isStandalone()) {
      setState("install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    try {
      const reg = await registration();
      const subscription = await reg.pushManager.getSubscription();
      setState(subscription ? "on" : "off");
    } catch {
      setState("unsupported");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await registration();
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        const { publicKey } = await apiFetch<{ publicKey: string }>("/api/push/key");
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(publicKey),
        });
      }
      await apiFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’activer les notifications");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    try {
      const reg = await registration();
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await apiFetch("/api/push/subscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de désactiver les notifications");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section notification-setting">
      <div className="notification-copy">
        <div className="settings-label">Notifications</div>
        {state === "checking" && <div className="settings-hint">Vérification…</div>}
        {state === "on" && <div className="settings-hint good">Activées sur cet appareil</div>}
        {state === "off" && <div className="settings-hint">Recevoir les nouveaux messages même quand le site est fermé</div>}
        {state === "install" && <div className="settings-hint">Sur iPhone/iPad : ouvre le site depuis l’écran d’accueil pour pouvoir activer les notifications.</div>}
        {state === "blocked" && <div className="settings-hint">Notifications bloquées dans les réglages de l’appareil.</div>}
        {state === "unsupported" && <div className="settings-hint">Les notifications push sont bloquées ou non prises en charge sur cet appareil.</div>}
        {error && <div className="form-error compact">{error}</div>}
      </div>
      {state === "on" && <button className="button ghost" disabled={busy} onClick={disable}>{busy ? "…" : "Désactiver"}</button>}
      {state === "off" && <button className="button primary" disabled={busy} onClick={enable}>{busy ? "…" : "Activer"}</button>}
    </section>
  );
}
