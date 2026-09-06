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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function NotificationSettings() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function registration() {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return navigator.serviceWorker.ready;
  }

  async function refresh() {
    setError("");
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
    } catch (e) {
      setState("off");
      setError(e instanceof Error ? e.message : "Impossible de vérifier les notifications");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
        await wait(350);
        if (Notification.permission === "granted") permission = "granted";
      }

      if (permission !== "granted") {
        if (Notification.permission === "denied" || permission === "denied") {
          setState("blocked");
          setError(isIosDevice()
            ? "iPadOS/iOS n’a pas laissé l’autorisation active. Sur un appareil scolaire, un profil de gestion peut bloquer les notifications même après avoir appuyé sur Autoriser."
            : "Les notifications sont bloquées dans les réglages du navigateur.");
        } else {
          setState("off");
          setError("L’autorisation n’a pas encore été accordée.");
        }
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
      const message = e instanceof Error ? e.message : "Impossible d’activer les notifications";
      if (Notification.permission === "denied") {
        setState("blocked");
        setError(isIosDevice()
          ? "iPadOS indique finalement que les notifications sont bloquées. Sur un iPad scolaire, cela peut venir du profil MDM de l’école."
          : message);
      } else {
        setState("off");
        setError(message);
      }
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
        {state === "off" && <div className="settings-hint">Recevoir les nouveaux messages quand Manuel Pro est fermé ou en arrière-plan</div>}
        {state === "install" && <div className="settings-hint">Sur iPhone/iPad : ouvre Manuel Pro depuis l’écran d’accueil pour pouvoir activer les notifications.</div>}
        {state === "blocked" && <div className="settings-hint">iOS/iPadOS indique que les notifications ne sont pas autorisées sur cet appareil.</div>}
        {state === "unsupported" && <div className="settings-hint">Les notifications push sont bloquées ou non prises en charge sur cet appareil.</div>}
        {error && <div className="form-error compact">{error}</div>}
      </div>
      {state === "on" && <button className="button ghost" disabled={busy} onClick={disable}>{busy ? "…" : "Désactiver"}</button>}
      {state === "off" && <button className="button primary" disabled={busy} onClick={enable}>{busy ? "…" : "Activer"}</button>}
      {state === "blocked" && <button className="button ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "…" : "Revérifier"}</button>}
    </section>
  );
}
