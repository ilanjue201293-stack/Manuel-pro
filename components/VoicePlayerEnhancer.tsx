"use client";

import { useEffect } from "react";

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function makeBars(wrapper: HTMLElement, audio: HTMLAudioElement) {
  if (audio.nextElementSibling?.classList.contains("voice-player-v2")) return;
  audio.style.display = "none";

  const player = document.createElement("div");
  player.className = "voice-player-v2";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "voice-play-v2";
  play.textContent = "▶";
  play.setAttribute("aria-label", "Lire le vocal");

  const wave = document.createElement("button");
  wave.type = "button";
  wave.className = "voice-wave-v2";
  wave.setAttribute("aria-label", "Position du vocal");
  const bars: HTMLSpanElement[] = [];
  for (let i = 0; i < 32; i += 1) {
    const bar = document.createElement("span");
    const height = 6 + ((i * 17 + i * i * 7) % 22);
    bar.style.height = `${height}px`;
    wave.appendChild(bar);
    bars.push(bar);
  }

  const time = document.createElement("span");
  time.className = "voice-time-v2";
  time.textContent = "0:00";
  player.append(play, wave, time);
  audio.insertAdjacentElement("afterend", player);

  const paint = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const progress = duration > 0 ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0;
    const active = Math.floor(progress * bars.length);
    bars.forEach((bar, index) => bar.classList.toggle("active", index <= active));
    time.textContent = audio.currentTime > 0 ? `${formatTime(audio.currentTime)} / ${formatTime(duration)}` : formatTime(duration);
    play.textContent = audio.paused ? "▶" : "Ⅱ";
  };

  play.addEventListener("click", () => {
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  });
  wave.addEventListener("click", (event) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    paint();
  });
  audio.addEventListener("loadedmetadata", paint);
  audio.addEventListener("durationchange", paint);
  audio.addEventListener("timeupdate", paint);
  audio.addEventListener("play", paint);
  audio.addEventListener("pause", paint);
  audio.addEventListener("ended", paint);
  paint();
  void wrapper;
}

export default function VoicePlayerEnhancer() {
  useEffect(() => {
    const scan = () => {
      document.querySelectorAll<HTMLAudioElement>(".message audio").forEach((audio) => {
        const parent = audio.parentElement;
        if (parent) makeBars(parent, audio);
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
