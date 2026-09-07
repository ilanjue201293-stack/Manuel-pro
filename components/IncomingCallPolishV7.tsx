"use client";

import { useEffect } from "react";

export default function IncomingCallPolishV7() {
  useEffect(() => {
    let syncing = false;

    const sync = () => {
      if (syncing) return;
      syncing = true;
      try {
        document.querySelectorAll<HTMLElement>(".incoming-call-v3").forEach((overlay) => {
          const text = overlay.textContent || "";
          const video = /vidéo/i.test(text);
          overlay.classList.toggle("incoming-video-v7", video);
          overlay.classList.toggle("incoming-audio-v7", !video);

          const accept = overlay.querySelector<HTMLElement>(".call-actions.incoming .call-action.accept span");
          if (accept) {
            const wanted = video ? "📹" : "📞";
            if (accept.textContent !== wanted) accept.textContent = wanted;
          }
        });
      } finally {
        syncing = false;
      }
    };

    sync();
    const observer = new MutationObserver(() => queueMicrotask(sync));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
