"use client";

import { useEffect, useRef } from "react";

function audioContextCtor() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export default function CallSounds() {
  const contextRef = useRef<AudioContext | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const hadCallRef = useRef(false);
  const incomingRef = useRef(false);

  useEffect(() => {
    const ensureContext = async () => {
      const Ctor = audioContextCtor();
      if (!Ctor) return null;
      if (!contextRef.current) contextRef.current = new Ctor();
      if (contextRef.current.state === "suspended") {
        await contextRef.current.resume().catch(() => undefined);
      }
      return contextRef.current;
    };

    const tone = async (frequency: number, startDelay: number, duration: number, volume: number) => {
      const context = await ensureContext();
      if (!context || context.state !== "running") return;
      const now = context.currentTime + startDelay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    };

    const ringPulse = () => {
      void tone(659.25, 0, 0.22, 0.035);
      void tone(783.99, 0.26, 0.24, 0.032);
      void tone(659.25, 0.56, 0.18, 0.027);
    };

    const playHangup = () => {
      void tone(523.25, 0, 0.13, 0.04);
      void tone(392, 0.14, 0.18, 0.038);
    };

    const stopRinging = () => {
      if (ringTimerRef.current) window.clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
      incomingRef.current = false;
    };

    const startRinging = () => {
      if (incomingRef.current) return;
      incomingRef.current = true;
      ringPulse();
      ringTimerRef.current = window.setInterval(ringPulse, 2400);
    };

    const sync = () => {
      const incoming = Boolean(document.querySelector(".incoming-call-v3"));
      const active = Array.from(document.querySelectorAll<HTMLElement>(".call-overlay"))
        .some((overlay) => !overlay.classList.contains("incoming-call-v3"));
      const present = incoming || active;

      if (incoming) startRinging();
      else stopRinging();

      if (present) {
        hadCallRef.current = true;
        if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
        endTimerRef.current = null;
      } else if (hadCallRef.current && !endTimerRef.current) {
        // Small debounce avoids playing the end sound while the incoming screen
        // is being replaced by the active-call screen after accepting.
        endTimerRef.current = window.setTimeout(() => {
          const stillGone = !document.querySelector(".call-overlay");
          if (stillGone && hadCallRef.current) playHangup();
          hadCallRef.current = false;
          endTimerRef.current = null;
        }, 280);
      }
    };

    // Prime/resume Web Audio after a real user interaction (required by iOS/WebKit).
    const unlock = () => { void ensureContext(); };
    document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    document.addEventListener("touchstart", unlock, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void ensureContext();
    });

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      stopRinging();
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, []);

  return null;
}
