"use client";

import { useEffect } from "react";

export default function IncomingCallPolishV7() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>(".incoming-call-v3").forEach((overlay) => {
        const text = overlay.textContent || "";
        const video = /vidéo/i.test(text);
        overlay.classList.toggle("incoming-video-v7", video);
        overlay.classList.toggle("incoming-audio-v7", !video);
        const accept = overlay.querySelector<HTMLElement>(".call-actions.incoming .call-action.accept span");
        if (accept) accept.textContent = video ? "📹" : "📞";
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
