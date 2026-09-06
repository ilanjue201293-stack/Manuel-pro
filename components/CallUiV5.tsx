"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function CallUiV5() {
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [title, setTitle] = useState("Appel en cours");
  const [duration, setDuration] = useState("0:00");
  const [video, setVideo] = useState(false);
  const connectionSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const currentOverlay = document.querySelector<HTMLElement>(".call-overlay:not(.incoming-call-v3)");
      setOverlay((previous) => previous === currentOverlay ? previous : currentOverlay);
      if (!currentOverlay) {
        setHost(null);
        setMinimized(false);
        connectionSinceRef.current = null;
        return;
      }

      setVideo(currentOverlay.classList.contains("video-mode"));
      const controls = currentOverlay.querySelector<HTMLElement>(".call-controls-v3");
      if (controls) {
        let target = controls.querySelector<HTMLElement>("[data-call-minimize-host-v5]");
        if (!target) {
          target = document.createElement("span");
          target.dataset.callMinimizeHostV5 = "true";
          target.className = "call-minimize-host-v5";
          const invite = controls.querySelector(".call-action.invite");
          controls.insertBefore(target, invite || null);
        }
        setHost((previous) => previous === target ? previous : target);
      }

      const durationText = currentOverlay.querySelector<HTMLElement>(".call-top-duration-v3")?.textContent?.trim();
      if (durationText) setDuration(durationText);
      const roomTitle = currentOverlay.querySelector<HTMLElement>(".call-room-title-v3 strong")?.textContent?.trim();
      const videoName = currentOverlay.querySelector<HTMLElement>(".video-name-v3 strong")?.textContent?.trim();
      setTitle(roomTitle || videoName || (currentOverlay.classList.contains("video-mode") ? "Appel vidéo" : "Appel audio"));

      const connecting = Array.from(currentOverlay.querySelectorAll<HTMLElement>(".video-away-v3 span, .audio-person-v3 small"))
        .some((node) => /connexion/i.test(node.textContent || ""));
      if (connecting) {
        if (!connectionSinceRef.current) connectionSinceRef.current = Date.now();
        if (Date.now() - connectionSinceRef.current > 7000) currentOverlay.classList.add("call-stale-connection-v5");
      } else {
        connectionSinceRef.current = null;
        currentOverlay.classList.remove("call-stale-connection-v5");
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(sync, 700);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!overlay) return;
    overlay.classList.toggle("call-minimized-v5", minimized);
    return () => overlay.classList.remove("call-minimized-v5");
  }, [overlay, minimized]);

  function endCall() {
    const button = overlay?.querySelector<HTMLButtonElement>(".call-controls-v3 .call-action.decline");
    button?.click();
  }

  return <>
    {host && overlay && createPortal(
      <button className="call-action call-minimize-action-v5" onClick={() => setMinimized(true)} aria-label="Minimiser l’appel">
        <span>⌄</span><small>Réduire</small>
      </button>,
      host,
    )}

    {minimized && overlay && <div className="call-mini-v5" role="status">
      <button className="call-mini-main-v5" onClick={() => setMinimized(false)} aria-label="Revenir à l’appel">
        <span className="call-mini-icon-v5">{video ? "📹" : "📞"}</span>
        <span className="call-mini-copy-v5"><strong>{title}</strong><small>{duration} • toucher pour revenir</small></span>
      </button>
      <button className="call-mini-end-v5" onClick={endCall} aria-label="Raccrocher">✕</button>
    </div>}

    {overlay?.classList.contains("call-stale-connection-v5") && !minimized && (
      <div className="call-reconnect-v5">Connexion instable — reconnexion automatique…</div>
    )}
  </>;
}
