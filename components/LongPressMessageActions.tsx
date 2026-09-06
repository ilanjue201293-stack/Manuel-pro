"use client";

import { useEffect, useRef } from "react";

const HOLD_MS = 520;
const MOVE_TOLERANCE = 12;

export default function LongPressMessageActions() {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; article: HTMLElement } | null>(null);
  const firedRef = useRef(false);
  const currentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      startRef.current = null;
    };

    const closeCurrent = () => {
      const current = currentRef.current;
      if (!current) return;
      const reactButton = Array.from(current.querySelectorAll<HTMLButtonElement>(".message-actions-v3 button"))
        .find((button) => /réagir/i.test(button.textContent || ""));
      if (current.querySelector(".reaction-picker.v3")) reactButton?.click();
      if (current.querySelector(".message-actions-v3")) current.querySelector<HTMLButtonElement>(".message-more-v3")?.click();
      current.classList.remove("longpress-open-v6");
      currentRef.current = null;
    };

    const openActions = (article: HTMLElement) => {
      if (currentRef.current && currentRef.current !== article) closeCurrent();
      const trigger = article.querySelector<HTMLButtonElement>(".message-more-v3");
      if (!trigger) return;

      article.classList.add("longpress-open-v6");
      currentRef.current = article;
      if (!article.querySelector(".message-actions-v3")) trigger.click();

      window.setTimeout(() => {
        const selected = currentRef.current;
        if (!selected || selected !== article) return;
        const reactButton = Array.from(selected.querySelectorAll<HTMLButtonElement>(".message-actions-v3 button"))
          .find((button) => /réagir/i.test(button.textContent || ""));
        if (!selected.querySelector(".reaction-picker.v3")) reactButton?.click();
      }, 0);
    };

    const validTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      if (target.closest("a,button,input,textarea,audio,video")) return null;
      const bubble = target.closest<HTMLElement>(".message-v3 .bubble");
      if (!bubble) return null;
      return bubble.closest<HTMLElement>(".message-v3");
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const article = validTarget(event.target);
      if (!article) return;

      firedRef.current = false;
      startRef.current = { x: event.clientX, y: event.clientY, article };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        openActions(article);
        navigator.vibrate?.(12);
      }, HOLD_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) clearTimer();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (firedRef.current) {
        event.preventDefault();
        event.stopPropagation();
      }
      firedRef.current = false;
      clearTimer();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (validTarget(event.target)) event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      const current = currentRef.current;
      if (!current) return;
      if (event.target instanceof Node && current.contains(event.target)) return;
      closeCurrent();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("click", onClick, true);

    return () => {
      clearTimer();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
