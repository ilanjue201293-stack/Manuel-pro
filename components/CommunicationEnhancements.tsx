"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/client-api";
import type { ProfileId } from "@/types/chat";

const NAME_TO_ID: Record<string, ProfileId> = {
  Ilan: "ilan",
  "Naïm": "naim",
  Naim: "naim",
  Juul: "juul",
  Ruben: "ruben",
};

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function preferredAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const choices = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return choices.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function activityLabel(kind: string | null) {
  if (kind === "typing") return "écrit…";
  if (kind === "recording") return "enregistre un vocal…";
  return "";
}

export default function CommunicationEnhancements() {
  const [voiceHost, setVoiceHost] = useState<HTMLElement | null>(null);
  const [callHost, setCallHost] = useState<HTMLElement | null>(null);
  const [activityHost, setActivityHost] = useState<HTMLElement | null>(null);
  const [calleeId, setCalleeId] = useState<ProfileId | null>(null);
  const calleeRef = useRef<ProfileId | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([3, 5, 4, 6, 3, 5, 4]);
  const [remoteActivity, setRemoteActivity] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const typingIdleRef = useRef<number | null>(null);
  const lastTypingPingRef = useRef(0);
  const discardRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const lastLevelPaintRef = useRef(0);

  useEffect(() => { calleeRef.current = calleeId; }, [calleeId]);

  async function postActivity(kind: "typing" | "recording" | "idle", target = calleeRef.current) {
    if (!target) return;
    await apiFetch("/api/activity", {
      method: "POST",
      body: JSON.stringify({ targetId: target, kind }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    const syncHosts = () => {
      const composer = document.querySelector<HTMLElement>(".composer");
      if (composer) {
        let host = composer.querySelector<HTMLElement>("[data-voice-tools-host]");
        if (!host) {
          host = document.createElement("span");
          host.dataset.voiceToolsHost = "true";
          host.className = "voice-tools-host";
          const textarea = composer.querySelector("textarea");
          composer.insertBefore(host, textarea || null);
        }
        setVoiceHost((current) => current === host ? current : host);
      } else setVoiceHost(null);

      const header = document.querySelector<HTMLElement>(".chat-head");
      if (header) {
        let call = header.querySelector<HTMLElement>("[data-call-tools-host]");
        if (!call) {
          call = document.createElement("span");
          call.dataset.callToolsHost = "true";
          call.className = "call-tools-host";
          header.appendChild(call);
        }
        setCallHost((current) => current === call ? current : call);

        let activity = header.querySelector<HTMLElement>("[data-activity-host]");
        const copy = header.querySelector<HTMLElement>(".chat-head-copy");
        if (copy && !activity) {
          activity = document.createElement("span");
          activity.dataset.activityHost = "true";
          activity.className = "activity-host";
          copy.appendChild(activity);
        }
        setActivityHost((current) => current === activity ? current : activity || null);

        const title = header.querySelector<HTMLElement>(".chat-head-copy strong")?.textContent?.trim() || "";
        const subtitle = header.querySelector<HTMLElement>(".chat-head-copy small")?.textContent?.trim() || "";
        setCalleeId(!/membre/i.test(subtitle) ? (NAME_TO_ID[title] || null) : null);
      } else {
        setCallHost(null);
        setActivityHost(null);
        setCalleeId(null);
      }
    };

    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.closest(".composer") || !calleeRef.current) return;
      const now = Date.now();
      if (target.value.trim() && now - lastTypingPingRef.current > 1200) {
        lastTypingPingRef.current = now;
        void postActivity("typing");
      }
      if (typingIdleRef.current) window.clearTimeout(typingIdleRef.current);
      typingIdleRef.current = window.setTimeout(() => void postActivity("idle"), 2600);
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);

  useEffect(() => {
    if (!calleeId) { setRemoteActivity(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await apiFetch<{ activities: { profileId: ProfileId; kind: string }[] }>("/api/activity");
        if (cancelled) return;
        const row = result.activities.find((item) => item.profileId === calleeId);
        setRemoteActivity(row?.kind || null);
      } catch {}
    };
    void poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [calleeId]);

  useEffect(() => {
    return () => {
      discardRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (typingIdleRef.current) window.clearTimeout(typingIdleRef.current);
      if (analyserFrameRef.current) cancelAnimationFrame(analyserFrameRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close().catch(() => undefined);
      void postActivity("idle");
    };
  }, []);

  function injectRecording(file: File) {
    const input = document.querySelector<HTMLInputElement>(".composer input[type='file']:not([accept='image/gif'])");
    if (!input) throw new Error("Zone de message introuvable");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function startMeter(stream: MediaStream) {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const context = new AudioCtx();
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = .72;
    context.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = context;
    analyserRef.current = analyser;
    const values = new Uint8Array(analyser.frequencyBinCount);
    const draw = (time: number) => {
      analyser.getByteFrequencyData(values);
      if (time - lastLevelPaintRef.current > 70) {
        lastLevelPaintRef.current = time;
        const bins = [1, 3, 5, 7, 9, 12, 15];
        setLevels(bins.map((index) => Math.max(3, Math.min(22, Math.round((values[index] / 255) * 22)))));
      }
      analyserFrameRef.current = requestAnimationFrame(draw);
    };
    analyserFrameRef.current = requestAnimationFrame(draw);
  }

  async function stopMeter() {
    if (analyserFrameRef.current) cancelAnimationFrame(analyserFrameRef.current);
    analyserFrameRef.current = null;
    analyserRef.current = null;
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevels([3, 5, 4, 6, 3, 5, 4]);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      alert("L’enregistrement vocal n’est pas pris en charge sur cet appareil.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      discardRef.current = false;
      const mimeType = preferredAudioMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const chunks = chunksRef.current;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void stopMeter();
        void postActivity("idle");
        if (!discardRef.current && chunks.length) {
          const blob = new Blob(chunks, { type: finalType });
          const extension = finalType.includes("mp4") ? "m4a" : finalType.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `Vocal-${Date.now()}.${extension}`, { type: finalType });
          try { injectRecording(file); } catch (error) { alert(error instanceof Error ? error.message : "Vocal impossible à préparer"); }
        }
        chunksRef.current = [];
      };
      recorder.start(220);
      startMeter(stream);
      setSeconds(0);
      setRecording(true);
      void postActivity("recording");
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => value + 1);
        void postActivity("recording");
      }, 1000);
    } catch (error) {
      alert(error instanceof Error ? `Microphone : ${error.message}` : "Impossible d’accéder au microphone");
    }
  }

  function stopRecording(discard = false) {
    discardRef.current = discard;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    void postActivity("idle");
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void stopMeter();
    }
  }

  function startCall(type: "audio" | "video") {
    if (!calleeId) return;
    window.dispatchEvent(new CustomEvent("MANUEL_PRO_START_CALL", { detail: { calleeId, callType: type } }));
  }

  return <>
    {voiceHost && createPortal(
      <div className={`voice-recorder-control ${recording ? "recording" : ""}`}>
        {recording && <button type="button" className="voice-cancel" onClick={() => stopRecording(true)} aria-label="Annuler le vocal">×</button>}
        <button type="button" className="voice-record-button" onClick={() => recording ? stopRecording(false) : void startRecording()} aria-label={recording ? "Terminer le vocal" : "Enregistrer un vocal"}>
          {recording ? "■" : "🎙"}
        </button>
        {recording && <span className="voice-live-meter" aria-hidden="true">{levels.map((height, index) => <i key={index} style={{ height }} />)}</span>}
        {recording && <span className="voice-record-time"><i />{formatDuration(seconds)}</span>}
      </div>, voiceHost,
    )}
    {callHost && calleeId && createPortal(
      <div className="header-call-actions">
        <button type="button" className="header-call-button" onClick={() => startCall("audio")} aria-label="Appel audio">📞</button>
        <button type="button" className="header-call-button video" onClick={() => startCall("video")} aria-label="Appel vidéo">▰</button>
      </div>, callHost,
    )}
    {activityHost && remoteActivity && createPortal(
      <span className={`activity-indicator ${remoteActivity}`}><i><b /><b /><b /></i>{activityLabel(remoteActivity)}</span>, activityHost,
    )}
  </>;
}
