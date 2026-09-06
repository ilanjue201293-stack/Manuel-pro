"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/client-api";
import type { ProfileId, PublicProfile } from "@/types/chat";

type CallStatus = "ringing" | "accepted" | "rejected" | "ended";
type CallType = "audio" | "video";
type CallInfo = {
  id: string;
  callerId: ProfileId;
  calleeId: ProfileId;
  status: CallStatus;
  callType: CallType;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  other: PublicProfile;
};
type SignalRow = { id: number | string; sender_id: ProfileId; kind: "offer" | "answer" | "ice"; payload: any };
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
  const [videoOff, setVideoOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<CallInfo | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cursorRef = useRef(0);
  const queuedSignalsRef = useRef<SignalRow[]>([]);
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const processingRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const shuttingDownRef = useRef(false);

  useEffect(() => { callRef.current = call; }, [call]);

  useEffect(() => {
    if (call?.callType !== "video") return;
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
      void localVideoRef.current.play().catch(() => undefined);
    }
  }, [call, phase, facingMode]);

  const closePeer = useCallback(() => {
    shuttingDownRef.current = true;
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const clearCall = useCallback((message = "") => {
    closePeer();
    callRef.current = null;
    setCall(null);
    setPhase("idle");
    setMuted(false);
    setVideoOff(false);
    setElapsed(0);
    setFacingMode("user");
    setError(message);
    cursorRef.current = 0;
    queuedSignalsRef.current = [];
    queuedIceRef.current = [];
    processingRef.current = false;
    connectedAtRef.current = null;
    window.setTimeout(() => { shuttingDownRef.current = false; }, 0);
  }, [closePeer]);

  const sendSignal = useCallback(async (callId: string, kind: "offer" | "answer" | "ice", payload: object) => {
    await apiFetch(`/api/calls/${callId}/signal`, {
      method: "POST",
      body: JSON.stringify({ kind, payload }),
    });
  }, []);

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    for (const candidate of queuedIceRef.current.splice(0)) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  }, []);

  const processSignals = useCallback(async () => {
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
          } else queuedIceRef.current.push(candidate);
          continue;
        }

        if (signal.kind === "offer" && current.calleeId === me.id && !pc.remoteDescription) {
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          await flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal(current.id, "answer", answer);
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

  const makePeer = useCallback(async (current: CallInfo, stream: MediaStream) => {
    const previous = pcRef.current;
    if (previous) {
      previous.onconnectionstatechange = null;
      previous.close();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = stream;
    shuttingDownRef.current = false;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    if (current.callType === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play().catch(() => undefined);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(current.id, "ice", event.candidate.toJSON()).catch(() => undefined);
    };
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      if (current.callType === "video") {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play().catch(() => undefined);
        }
      } else if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        void remoteAudioRef.current.play().catch(() => undefined);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        connectedAtRef.current = Date.now();
        setPhase("connected");
      } else if (["failed", "closed"].includes(pc.connectionState) && !shuttingDownRef.current && callRef.current) {
        void apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
        clearCall("Appel terminé");
      }
    };
    await processSignals();
    return pc;
  }, [clearCall, processSignals, sendSignal]);

  const getMedia = useCallback(async (callType: CallType, facing: "user" | "environment" = "user") => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Micro/caméra non disponible sur cet appareil");
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: callType === "video" ? { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }, []);

  const startOutgoing = useCallback(async (calleeId: ProfileId, callType: CallType) => {
    if (callRef.current || phase !== "idle") return;
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await getMedia(callType, "user");
      const result = await apiFetch<{ call: CallInfo }>("/api/calls", {
        method: "POST",
        body: JSON.stringify({ calleeId, callType }),
      });
      callRef.current = result.call;
      setCall(result.call);
      setPhase("calling");
      const pc = await makePeer(result.call, stream);
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: callType === "video" });
      await pc.setLocalDescription(offer);
      await sendSignal(result.call.id, "offer", offer);
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      clearCall(e instanceof Error ? e.message : "Impossible de lancer l’appel");
    }
  }, [clearCall, getMedia, makePeer, phase, sendSignal]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ calleeId?: ProfileId; callType?: CallType }>).detail;
      if (detail?.calleeId) void startOutgoing(detail.calleeId, detail.callType === "video" ? "video" : "audio");
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
        callRef.current = result.call;
        setCall(result.call);
        setPhase(result.call.calleeId === me.id ? "incoming" : "calling");
      } catch {}
    };
    void check();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 850);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [call, me.id]);

  useEffect(() => {
    if (!call) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await apiFetch<{ call: { status: CallStatus; callType: CallType }; signals: SignalRow[] }>(`/api/calls/${call.id}?after=${cursorRef.current}`);
        if (stopped) return;
        if (result.signals?.length) {
          cursorRef.current = Math.max(cursorRef.current, ...result.signals.map((signal) => Number(signal.id) || 0));
          queuedSignalsRef.current.push(...result.signals);
          void processSignals();
        }
        if (result.call.status === "accepted" && phase === "calling") setPhase("connecting");
        if (result.call.status === "rejected") clearCall("Appel refusé");
        if (result.call.status === "ended") clearCall("Appel terminé");
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 520);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [call, clearCall, phase, processSignals]);

  useEffect(() => {
    if (phase !== "connected") return;
    const timer = window.setInterval(() => {
      if (connectedAtRef.current) setElapsed(Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    const current = callRef.current;
    shuttingDownRef.current = true;
    if (current) void apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
    closePeer();
  }, [closePeer]);

  async function accept() {
    const current = callRef.current;
    if (!current || phase !== "incoming") return;
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await getMedia(current.callType, "user");
      setPhase("connecting");
      await makePeer(current, stream);
      await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "accept" }) });
      await processSignals();
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }).catch(() => undefined);
      clearCall(e instanceof Error ? e.message : "Impossible d’accepter l’appel");
    }
  }

  async function decline() {
    const current = callRef.current;
    if (!current) return;
    shuttingDownRef.current = true;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }).catch(() => undefined);
    clearCall();
  }

  async function hangup() {
    const current = callRef.current;
    if (!current) return;
    shuttingDownRef.current = true;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
    clearCall();
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  function toggleVideo() {
    const next = !videoOff;
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setVideoOff(next);
  }

  async function switchCamera() {
    const current = callRef.current;
    const pc = pcRef.current;
    if (!current || current.callType !== "video" || !pc) return;
    const next = facingMode === "user" ? "environment" : "user";
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = camera.getVideoTracks()[0];
      const sender = pc.getSenders().find((item) => item.track?.kind === "video");
      if (!newTrack || !sender) throw new Error("Caméra indisponible");
      await sender.replaceTrack(newTrack);
      const stream = streamRef.current;
      const old = stream?.getVideoTracks()[0];
      if (stream && old) stream.removeTrack(old);
      old?.stop();
      stream?.addTrack(newTrack);
      setFacingMode(next);
      setVideoOff(false);
      if (localVideoRef.current && stream) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de changer de caméra");
    }
  }

  if (!call || phase === "idle") return <audio ref={remoteAudioRef} autoPlay playsInline hidden />;

  const incoming = phase === "incoming";
  const connected = phase === "connected";
  const isVideo = call.callType === "video";
  const subtitle = incoming
    ? (isVideo ? "Appel vidéo entrant" : "Appel audio entrant")
    : phase === "calling"
      ? "Sonnerie…"
      : phase === "connecting"
        ? "Connexion…"
        : formatTime(elapsed);

  return <>
    <audio ref={remoteAudioRef} autoPlay playsInline hidden />
    <div className={`call-overlay ${isVideo ? "video-mode" : "audio-mode"}`} role="dialog" aria-modal="true">
      {isVideo && <div className="video-call-stage">
        <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
        {!connected && <div className="video-call-placeholder"><Avatar src={call.other.avatarUrl} profileId={call.other.id} name={call.other.displayName} size={104} /><span>{subtitle}</span></div>}
        <div className="video-call-topbar"><span><strong>{call.other.displayName}</strong><small>{subtitle}</small></span></div>
        <div className={`local-video-card ${videoOff ? "off" : ""}`}>
          <video ref={localVideoRef} autoPlay muted playsInline />
          {videoOff && <span>Caméra coupée</span>}
        </div>
      </div>}

      <div className={`call-panel ${isVideo ? "video-controls" : ""}`}>
        {!isVideo && <>
          <div className="call-pulse"><Avatar src={call.other.avatarUrl} profileId={call.other.id} name={call.other.displayName} size={100} /></div>
          <h2>{call.other.displayName}</h2>
          <p>{subtitle}</p>
        </>}
        {error && <div className="call-error">{error}</div>}
        {incoming ? <div className="call-actions incoming">
          <button className="call-action decline" onClick={() => void decline()}><span>✕</span><small>Refuser</small></button>
          <button className="call-action accept" onClick={() => void accept()}><span>{isVideo ? "▰" : "📞"}</span><small>Accepter</small></button>
        </div> : <div className="call-actions active-call-actions">
          <button className={`call-action mute ${muted ? "active" : ""}`} onClick={toggleMute}><span>{muted ? "🔇" : "🎙"}</span><small>{muted ? "Micro" : "Muet"}</small></button>
          {isVideo && <button className={`call-action camera ${videoOff ? "active" : ""}`} onClick={toggleVideo}><span>{videoOff ? "◼" : "▰"}</span><small>Caméra</small></button>}
          {isVideo && <button className="call-action flip" onClick={() => void switchCamera()}><span>↻</span><small>Retourner</small></button>}
          <button className="call-action decline" onClick={() => void hangup()}><span>✕</span><small>Raccrocher</small></button>
        </div>}
      </div>
    </div>
  </>;
}
