"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function CallDeafenMode() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [deafened, setDeafened] = useState(false);
  const micWasMutedRef = useRef(false);
  const overlayRef = useRef<HTMLElement | null>(null);
  const deafenedRef = useRef(false);

  useEffect(() => { deafenedRef.current = deafened; }, [deafened]);

  function getRemoteMedia(overlay: HTMLElement) {
    return Array.from(overlay.querySelectorAll<HTMLMediaElement>("audio, .video-person-v3 video, .remote-video"))
      .filter((media) => !media.closest(".local-video-card"));
  }

  function muteRemoteOutput(overlay: HTMLElement, value: boolean) {
    for (const media of getRemoteMedia(overlay)) {
      media.muted = value;
      if (media instanceof HTMLAudioElement) media.volume = value ? 0 : 1;
    }
  }

  useEffect(() => {
    const sync = () => {
      const overlay = document.querySelector<HTMLElement>(".call-overlay:not(.incoming-call-v3)");
      const controls = overlay?.querySelector<HTMLElement>(".call-controls-v3") || null;
      overlayRef.current = overlay || null;
      setHost((current) => current === controls ? current : controls);

      if (!overlay || !controls) {
        if (deafenedRef.current) setDeafened(false);
        micWasMutedRef.current = false;
        return;
      }

      if (deafenedRef.current) muteRemoteOutput(overlay, true);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      const overlay = overlayRef.current;
      if (overlay) muteRemoteOutput(overlay, false);
    };
  }, []);

  function toggleDeafen() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const muteButton = overlay.querySelector<HTMLButtonElement>(".call-action.mute");

    if (!deafened) {
      const micAlreadyMuted = Boolean(muteButton?.classList.contains("active"));
      micWasMutedRef.current = micAlreadyMuted;
      if (muteButton && !micAlreadyMuted) muteButton.click();
      muteRemoteOutput(overlay, true);
      setDeafened(true);
      return;
    }

    muteRemoteOutput(overlay, false);
    const currentMuteButton = overlay.querySelector<HTMLButtonElement>(".call-action.mute");
    if (currentMuteButton && !micWasMutedRef.current && currentMuteButton.classList.contains("active")) {
      currentMuteButton.click();
    }
    micWasMutedRef.current = false;
    setDeafened(false);
  }

  if (!host) return null;

  return createPortal(
    <button
      type="button"
      className={`call-action deafen ${deafened ? "active" : ""}`}
      onClick={toggleDeafen}
      aria-pressed={deafened}
      aria-label={deafened ? "Désactiver la sourdine" : "Activer la sourdine"}
      title={deafened ? "Réactiver le son et le micro" : "Couper le son reçu et le micro"}
    >
      <span>{deafened ? "🔇" : "🔕"}</span>
      <small>{deafened ? "Réactiver" : "Sourdine"}</small>
    </button>,
    host,
  );
}
