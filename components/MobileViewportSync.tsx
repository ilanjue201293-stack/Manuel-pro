"use client";

import { useEffect } from "react";

function scrollMessages(behavior: ScrollBehavior = "auto") {
  const messages = document.querySelector<HTMLElement>(".messages");
  if (!messages) return;
  messages.scrollTo({ top: messages.scrollHeight, behavior });
}

function scheduleBottom() {
  window.requestAnimationFrame(() => scrollMessages("auto"));
  window.setTimeout(() => scrollMessages("auto"), 80);
  window.setTimeout(() => scrollMessages("auto"), 260);
  window.setTimeout(() => scrollMessages("auto"), 520);
}

export default function MobileViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let lastMessageCount = document.querySelectorAll(".messages .message").length;

    const syncViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      root.style.setProperty("--visual-height", `${Math.round(height)}px`);
      root.style.setProperty("--visual-top", `${Math.round(top)}px`);

      const focused = document.activeElement;
      if (focused instanceof HTMLTextAreaElement && focused.closest(".composer")) {
        scheduleBottom();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement && target.closest(".composer")) {
        scheduleBottom();
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".conversation-item") || target.closest(".back"))) {
        scheduleBottom();
      }
    };

    const messageWatcher = window.setInterval(() => {
      const count = document.querySelectorAll(".messages .message").length;
      if (count !== lastMessageCount) {
        lastMessageCount = count;
        scheduleBottom();
      }
    }, 250);

    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("click", onClick);

    return () => {
      window.clearInterval(messageWatcher);
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("click", onClick);
      root.style.removeProperty("--visual-height");
      root.style.removeProperty("--visual-top");
    };
  }, []);

  return null;
}
