"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/client-api";
import type { ProfileId, PublicProfile } from "@/types/chat";

type CallStatus = "ringing" | "accepted" | "rejected" | "ended";
type CallInfo = {
  id: string;
  callerId: ProfileId;
  calleeId: ProfileId;
  status: CallStatus;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  other: PublicProfile;
};
type SignalRow = { id: number; sender_id: ProfileId; kind: "offer" | "answer" | "ice"; payload: any };
type Phase = "idle" | "incoming" | "calling" | "connecting" | "connected";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function CallManager({ me }: { me: PublicProfile }) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const callRef = useRef<CallInfo | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cursorRef = useRef(0);
  const queuedSignalsRef = useRef<SignalRow[]>([]);
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const processingRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const endingRef = useRef(false);

  useEffect(() => { callRef.current = call; }, [call]);

  const stopMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    queuedSignalsRef.current = [];
    queuedIceRef.current = [];
    cursorRef.current = 0;
    processingRef.current = false;
    connectedAtRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const reset = useCallback((message = "") => {
    stopMedia();
    setCall(null);
    setPhase("idle");
    setMuted(false);
    setElapsed(0);
    setError(message);
    endingRef.current = false;
  }, [stopMedia]);

  const sendSignal = useCallback(async (callId: string, kind: "offer" | "answer" | "ice", payload: object) => {
    await apiFetch(`/api/calls/${callId}/signal`, {
      method: "POST",
      body: JSON.stringify({ kind, payload }),
    });
  }, []);

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    const candidates = queuedIceRef.current.splice(0);
    for (const candidate of candidates) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  }, []);

  const processQueuedSignals = useCallback(async () => {
    if (processingRef.current || !pcRef.current || !callRef.current) return;
    processingRef.current = true;
    try {
      while (queuedSignalsRef.current.length && pcRef.current && callRef.current) {
        const signal = queuedSignalsRef.current.shift()!;
        const pc = pcRef.current;
        const current = callRef.current;

        if (signal.kind === "ice") {
          const candidate = signal.payload as RTCIceCandidateInit;
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(candidate); } catch {}
          } else {
            queuedIceRef.current.push(candidate);
          }
          continue;
        }

        if (signal.kind === "offer" && current.calleeId === me.id && !pc.remoteDescription) {
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          await flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal(current.id, "answer", answer.toJSON());
          continue;
        }

        if (signal.kind === "answer" && current.callerId === me.id && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          await flushIce();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de connexion de l’appel");
    } finally {
      processingRef.current = false;
    }
  }, [flushIce, me.id, sendSignal]);

  const createPeer = useCallback(async (current: CallInfo, stream: MediaStream) => {
    stopMedia();
    streamRef.current = stream;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(current.id, "ice", event.candidate.toJSON()).catch(() => undefined);
    };
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        void remoteAudioRef.current.play().catch(() => undefined);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        connectedAtRef.current = Date.now();
        setPhase("connected");
      } else if (["failed", "closed"].includes(pc.connectionState) && callRef.current && !endingRef.current) {
        void apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
        reset("Appel terminé");
      }
    };
    await processQueuedSignals();
    return pc;
  }, [processQueuedSignals, reset, sendSignal, stopMedia]);

  const microphone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone non disponible sur cet appareil");
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }, []);

  const startOutgoing = useCallback(async (calleeId: ProfileId) => {
    if (callRef.current || phase !== "idle") return;
    setError("");
    try {
      const stream = await microphone();
      const result = await apiFetch<{ call: CallInfo }>("/api/calls", {
        method: "POST",
        body: JSON.stringify({ calleeId }),
      });
      setCall(result.call);
      callRef.current = result.call;
      setPhase("calling");
      const pc = await createPeer(result.call, stream);
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await sendSignal(result.call.id, "offer", offer.toJSON());
    } catch (e) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      reset(e instanceof Error ? e.message : "Impossible de lancer l’appel");
    }
  }, [createPeer, microphone, phase, reset, sendSignal]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ calleeId?: ProfileId }>).detail;
      if (detail?.calleeId) void startOutgoing(detail.calleeId);
    };
    window.addEventListener("MANUEL_PRO_START_CALL", handler);
    return () => window.removeEventListener("MANUEL_PRO_START_CALL", handler);
  }, [startOutgoing]);

  useEffect(() => {
    if (call) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await apiFetch<{ call: CallInfo | null }>("/api/calls");
        if (cancelled || !result.call) return;
        if (result.call.status === "accepted") {
          await apiFetch(`/api/calls/${result.call.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
          return;
        }
        setCall(result.call);
        callRef.current = result.call;
        setPhase(result.call.calleeId === me.id ? "incoming" : "calling");
      } catch {}
    };
    void check();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [call, me.id]);

  useEffect(() => {
    if (!call) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await apiFetch<{ call: { status: CallStatus }; signals: SignalRow[] }>(`/api/calls/${call.id}?after=${cursorRef.current}`);
        if (stopped) return;
        if (result.signals?.length) {
          cursorRef.current = Math.max(cursorRef.current, ...result.signals.map((signal) => Number(signal.id) || 0));
          queuedSignalsRef.current.push(...result.signals);
          void processQueuedSignals();
        }
        if (result.call.status === "accepted" && phase === "calling") setPhase("connecting");
        if (result.call.status === "rejected") return reset("Appel refusé");
        if (result.call.status === "ended") return reset("Appel terminé");
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 650);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [call, phase, processQueuedSignals, reset]);

  useEffect(() => {
    if (phase !== "connected") return;
    const timer = window.setInterval(() => {
      if (connectedAtRef.current) setElapsed(Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    const current = callRef.current;
    if (current) void apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
    stopMedia();
  }, [stopMedia]);

  async function accept() {
    const current = callRef.current;
    if (!current || phase !== "incoming") return;
    setError("");
    try {
      const stream = await microphone();
      setPhase("connecting");
      await createPeer(current, stream);
      await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "accept" }) });
      await processQueuedSignals();
    } catch (e) {
      await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }).catch(() => undefined);
      reset(e instanceof Error ? e.message : "Impossible d’accepter l’appel");
    }
  }

  async function decline() {
    const current = callRef.current;
    if (!current) return;
    endingRef.current = true;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }).catch(() => undefined);
    reset();
  }

  async function hangup() {
    const current = callRef.current;
    if (!current) return;
    endingRef.current = true;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
    reset();
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  if (!call || phase === "idle") return <audio ref={remoteAudioRef} autoPlay playsInline hidden />;

  const incoming = phase === "incoming";
  const subtitle = incoming
    ? "Appel audio entrant"
    : phase === "calling"
      ? "Sonnerie…"
      : phase === "connecting"
        ? "Connexion…"
        : formatTime(elapsed);

  return <>
    <audio ref={remoteAudioRef} autoPlay playsInline hidden />
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-panel">
        <div className="call-pulse"><Avatar src={call.other.avatarUrl} profileId={call.other.id} name={call.other.displayName} size={96} /></div>
        <h2>{call.other.displayName}</h2>
        <p>{subtitle}</p>
        {error && <div className="call-error">{error}</div>}
        {incoming ? <div className="call-actions incoming">
          <button className="call-action decline" onClick={() => void decline()}><span>✕</span><small>Refuser</small></button>
          <button className="call-action accept" onClick={() => void accept()}><span>📞</span><small>Accepter</small></button>
        </div> : <div className="call-actions">
          <button className={`call-action mute ${muted ? "active" : ""}`} onClick={toggleMute}><span>{muted ? "🔇" : "🎙"}</span><small>{muted ? "Réactiver" : "Muet"}</small></button>
          <button className="call-action decline" onClick={() => void hangup()}><span>✕</span><small>Raccrocher</small></button>
        </div>}
      </div>
    </div>
  </>;
}
