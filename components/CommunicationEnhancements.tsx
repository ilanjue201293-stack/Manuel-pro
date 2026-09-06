"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProfileId } from "@/types/chat";

const NAME_TO_ID: Record<string, ProfileId> = {
  "Ilan": "ilan",
  "Naïm": "naim",
  "Naim": "naim",
  "Juul": "juul",
  "Ruben": "ruben",
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

export default function CommunicationEnhancements() {
  const [voiceHost, setVoiceHost] = useState<HTMLElement | null>(null);
  const [callHost, setCallHost] = useState<HTMLElement | null>(null);
  const [calleeId, setCalleeId] = useState<ProfileId | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const discardRef = useRef(false);

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
      } else {
        setVoiceHost(null);
      }

      const header = document.querySelector<HTMLElement>(".chat-head");
      if (header) {
        let host = header.querySelector<HTMLElement>("[data-call-tools-host]");
        if (!host) {
          host = document.createElement("span");
          host.dataset.callToolsHost = "true";
          host.className = "call-tools-host";
          header.appendChild(host);
        }
        setCallHost((current) => current === host ? current : host);
        const title = header.querySelector<HTMLElement>(".chat-head-copy strong")?.textContent?.trim() || "";
        const subtitle = header.querySelector<HTMLElement>(".chat-head-copy small")?.textContent?.trim() || "";
        setCalleeId(!/membre/i.test(subtitle) ? (NAME_TO_ID[title] || null) : null);
      } else {
        setCallHost(null);
        setCalleeId(null);
      }
    };

    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      discardRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const chunks = chunksRef.current;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!discardRef.current && chunks.length) {
          const blob = new Blob(chunks, { type: finalType });
          const extension = finalType.includes("mp4") ? "m4a" : finalType.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `Vocal-${Date.now()}.${extension}`, { type: finalType });
          try { injectRecording(file); } catch (error) { alert(error instanceof Error ? error.message : "Vocal impossible à préparer"); }
        }
        chunksRef.current = [];
      };
      recorder.start(250);
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (error) {
      alert(error instanceof Error ? `Microphone : ${error.message}` : "Impossible d’accéder au microphone");
    }
  }

  function stopRecording(discard = false) {
    discardRef.current = discard;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else streamRef.current?.getTracks().forEach((track) => track.stop());
  }

  function startCall() {
    if (!calleeId) return;
    window.dispatchEvent(new CustomEvent("MANUEL_PRO_START_CALL", { detail: { calleeId } }));
  }

  return <>
    {voiceHost && createPortal(
      <div className={`voice-recorder-control ${recording ? "recording" : ""}`}>
        {recording && <button type="button" className="voice-cancel" onClick={() => stopRecording(true)} aria-label="Annuler le vocal">×</button>}
        <button
          type="button"
          className="voice-record-button"
          onClick={() => recording ? stopRecording(false) : void startRecording()}
          aria-label={recording ? "Terminer le vocal" : "Enregistrer un vocal"}
        >
          {recording ? "■" : "🎙"}
        </button>
        {recording && <span className="voice-record-time"><i />{formatDuration(seconds)}</span>}
      </div>,
      voiceHost,
    )}
    {callHost && calleeId && createPortal(
      <button type="button" className="header-call-button" onClick={startCall} aria-label="Appeler">📞</button>,
      callHost,
    )}
  </>;
}
