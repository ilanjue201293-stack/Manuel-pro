"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/client-api";
import type { ProfileId, PublicProfile } from "@/types/chat";

type CallType = "audio" | "video";
type MemberState = "invited" | "joined" | "left" | "rejected";
type CallMember = PublicProfile & {
  state: MemberState;
  epoch: number;
  online: boolean;
  lastSeen: string | null;
  isCreator: boolean;
};
type CallInfo = {
  id: string;
  callType: CallType;
  status: "active" | "ended";
  createdBy: ProfileId;
  conversationId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  meState: MemberState;
  meEpoch: number;
  members: CallMember[];
};
type SignalRow = {
  id: number | string;
  sender_id: ProfileId;
  target_id: ProfileId;
  sender_epoch: number;
  target_epoch: number;
  kind: "offer" | "answer" | "ice";
  payload: any;
};
type Phase = "idle" | "incoming" | "active" | "resuming";
type PeerEntry = {
  pc: RTCPeerConnection;
  epoch: number;
  ice: RTCIceCandidateInit[];
};

type StartCallDetail = {
  calleeId?: ProfileId;
  conversationId?: string;
  callType?: CallType;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const ALL_PROFILES: { id: ProfileId; name: string }[] = [
  { id: "ilan", name: "Ilan" },
  { id: "naim", name: "Naïm" },
  { id: "juul", name: "Juul" },
  { id: "ruben", name: "Ruben" },
];

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function profileFallback(id: ProfileId) {
  return `/avatars/${id}.svg`;
}

export default function CallManager({ me }: { me: PublicProfile }) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const callRef = useRef<CallInfo | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<ProfileId, PeerEntry>());
  const cursorRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const resumingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => { callRef.current = call; }, [call]);

  const setRoom = useCallback((room: CallInfo | null) => {
    callRef.current = room;
    setCall(room);
  }, []);

  const closePeer = useCallback((profileId: ProfileId) => {
    const entry = peersRef.current.get(profileId);
    if (!entry) return;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    peersRef.current.delete(profileId);
    setRemoteStreams((current) => {
      if (!current[profileId]) return current;
      const next = { ...current };
      delete next[profileId];
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const id of Array.from(peersRef.current.keys())) closePeer(id);
    peersRef.current.clear();
    setRemoteStreams({});
  }, [closePeer]);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const clearLocalCall = useCallback((message = "") => {
    closeAllPeers();
    stopLocalMedia();
    cursorRef.current = 0;
    setRoom(null);
    setPhase("idle");
    setMuted(false);
    setVideoOff(false);
    setFacingMode("user");
    setElapsed(0);
    setShowInvite(false);
    setError(message);
    hiddenAtRef.current = null;
    resumingRef.current = false;
  }, [closeAllPeers, setRoom, stopLocalMedia]);

  const getMedia = useCallback(async (callType: CallType, facing: "user" | "environment" = "user") => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Micro/caméra non disponible sur cet appareil");
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: callType === "video"
        ? { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : false,
    });
  }, []);

  const sendSignal = useCallback(async (
    room: CallInfo,
    target: CallMember,
    kind: "offer" | "answer" | "ice",
    payload: object,
  ) => {
    await apiFetch(`/api/calls/${room.id}/signal`, {
      method: "POST",
      body: JSON.stringify({
        targetId: target.id,
        senderEpoch: room.meEpoch,
        targetEpoch: target.epoch,
        kind,
        payload,
      }),
    });
  }, []);

  const createPeer = useCallback(async (room: CallInfo, member: CallMember, makeOffer: boolean) => {
    if (!localStreamRef.current || room.meState !== "joined" || !member.online || member.state !== "joined") return null;
    const current = peersRef.current.get(member.id);
    if (current && current.epoch === member.epoch) return current;
    if (current) closePeer(member.id);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, epoch: member.epoch, ice: [] };
    peersRef.current.set(member.id, entry);
    localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));

    pc.onicecandidate = (event) => {
      const latest = callRef.current;
      const target = latest?.members.find((item) => item.id === member.id);
      if (!event.candidate || !latest || !target || target.epoch !== member.epoch) return;
      void sendSignal(latest, target, "ice", event.candidate.toJSON()).catch(() => undefined);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams((currentStreams) => ({ ...currentStreams, [member.id]: stream }));
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        closePeer(member.id);
      } else if (pc.connectionState === "disconnected") {
        window.setTimeout(() => {
          if (pc.connectionState === "disconnected" && peersRef.current.get(member.id)?.pc === pc) {
            closePeer(member.id);
          }
        }, 2200);
      }
    };

    if (makeOffer) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: room.callType === "video" });
      await pc.setLocalDescription(offer);
      await sendSignal(room, member, "offer", offer);
    }
    return entry;
  }, [closePeer, sendSignal]);

  const syncPeers = useCallback(async (room: CallInfo) => {
    if (!localStreamRef.current || room.meState !== "joined") return;
    const activeIds = new Set<ProfileId>();
    for (const member of room.members) {
      if (member.id === me.id) continue;
      if (member.state === "joined" && member.online) {
        activeIds.add(member.id);
        const existing = peersRef.current.get(member.id);
        if (!existing || existing.epoch !== member.epoch) {
          const offerer = me.id.localeCompare(member.id) < 0;
          try { await createPeer(room, member, offerer); } catch {}
        }
      }
    }
    for (const profileId of Array.from(peersRef.current.keys())) {
      if (!activeIds.has(profileId)) closePeer(profileId);
    }
  }, [closePeer, createPeer, me.id]);

  const processSignals = useCallback(async (room: CallInfo, signals: SignalRow[]) => {
    for (const signal of signals) {
      if (signal.target_id !== me.id || Number(signal.target_epoch) !== Number(room.meEpoch)) continue;
      const member = room.members.find((item) => item.id === signal.sender_id);
      if (!member || member.state !== "joined" || Number(member.epoch) !== Number(signal.sender_epoch)) continue;

      let entry = peersRef.current.get(member.id);
      if (!entry || entry.epoch !== member.epoch) {
        entry = await createPeer(room, member, false) || undefined;
      }
      if (!entry) continue;
      const pc = entry.pc;

      try {
        if (signal.kind === "ice") {
          const candidate = signal.payload as RTCIceCandidateInit;
          if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => undefined);
          else entry.ice.push(candidate);
          continue;
        }

        if (signal.kind === "offer") {
          if (pc.signalingState !== "stable") {
            try { await pc.setLocalDescription({ type: "rollback" }); } catch {}
          }
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          for (const candidate of entry.ice.splice(0)) await pc.addIceCandidate(candidate).catch(() => undefined);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const latest = callRef.current;
          const target = latest?.members.find((item) => item.id === member.id);
          if (latest && target) await sendSignal(latest, target, "answer", answer);
          continue;
        }

        if (signal.kind === "answer" && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
          for (const candidate of entry.ice.splice(0)) await pc.addIceCandidate(candidate).catch(() => undefined);
        }
      } catch {}
    }
  }, [createPeer, me.id, sendSignal]);

  const prepareJoinedRoom = useCallback(async (room: CallInfo, action: "accept" | "resume") => {
    if (resumingRef.current) return;
    resumingRef.current = true;
    setPhase(action === "accept" ? "active" : "resuming");
    setError("");
    closeAllPeers();
    stopLocalMedia();
    try {
      const stream = await getMedia(room.callType, "user");
      localStreamRef.current = stream;
      const result = await apiFetch<{ call: CallInfo | null }>(`/api/calls/${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      if (!result.call) throw new Error("L’appel est terminé");
      cursorRef.current = 0;
      setRoom(result.call);
      setPhase("active");
      setMuted(false);
      setVideoOff(false);
      setFacingMode("user");
      await syncPeers(result.call);
    } catch (e) {
      clearLocalCall(e instanceof Error ? e.message : "Reconnexion impossible");
    } finally {
      resumingRef.current = false;
    }
  }, [clearLocalCall, closeAllPeers, getMedia, setRoom, stopLocalMedia, syncPeers]);

  const startOutgoing = useCallback(async (detail: StartCallDetail) => {
    if (callRef.current || phase !== "idle") return;
    const callType: CallType = detail.callType === "video" ? "video" : "audio";
    let stream: MediaStream | null = null;
    setError("");
    try {
      stream = await getMedia(callType, "user");
      const result = await apiFetch<{ call: CallInfo }>("/api/calls", {
        method: "POST",
        body: JSON.stringify({
          calleeId: detail.calleeId,
          conversationId: detail.conversationId,
          callType,
        }),
      });
      localStreamRef.current = stream;
      cursorRef.current = 0;
      setRoom(result.call);
      setPhase("active");
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      clearLocalCall(e instanceof Error ? e.message : "Impossible de lancer l’appel");
    }
  }, [clearLocalCall, getMedia, phase, setRoom]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StartCallDetail>).detail || {};
      if (detail.calleeId || detail.conversationId) void startOutgoing(detail);
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
        setRoom(result.call);
        if (result.call.meState === "invited") {
          setPhase("incoming");
        } else if (result.call.meState === "joined") {
          void prepareJoinedRoom(result.call, "resume");
        }
      } catch {}
    };
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [call, prepareJoinedRoom, setRoom]);

  useEffect(() => {
    if (!call || call.meState !== "joined") return;
    let stopped = false;
    const heartbeatNow = async () => {
      if (document.visibilityState !== "visible") return;
      await apiFetch(`/api/calls/${call.id}`, { method: "PATCH", body: JSON.stringify({ action: "heartbeat" }) }).catch(() => undefined);
    };
    void heartbeatNow();
    const timer = window.setInterval(heartbeatNow, 2500);
    return () => { stopped = true; void stopped; window.clearInterval(timer); };
  }, [call?.id, call?.meState]);

  useEffect(() => {
    if (!call) return;
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await apiFetch<{ call: CallInfo; signals: SignalRow[] }>(`/api/calls/${call.id}?after=${cursorRef.current}`);
        if (stopped) return;
        if (!result.call || result.call.status === "ended" || ["left", "rejected"].includes(result.call.meState)) {
          clearLocalCall("Appel terminé");
          return;
        }
        if (result.signals?.length) {
          cursorRef.current = Math.max(cursorRef.current, ...result.signals.map((signal) => Number(signal.id) || 0));
        }
        setRoom(result.call);
        if (result.call.meState === "joined") {
          await syncPeers(result.call);
          if (result.signals?.length) await processSignals(result.call, result.signals);
        }
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 650);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [call?.id, clearLocalCall, processSignals, setRoom, syncPeers]);

  useEffect(() => {
    const onVisibility = () => {
      const current = callRef.current;
      if (!current || current.meState !== "joined") return;
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const wasAway = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (wasAway > 1200) void prepareJoinedRoom(current, "resume");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [prepareJoinedRoom]);

  useEffect(() => {
    if (!call?.startedAt) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(call.startedAt!).getTime()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [call?.startedAt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Important: on ne quitte PAS la room ici. iOS peut suspendre/démonter la PWA.
      // La room reste vivante et sera reprise au retour grâce à l'epoch de reconnexion.
      closeAllPeers();
      stopLocalMedia();
    };
  }, [closeAllPeers, stopLocalMedia]);

  async function accept() {
    const current = callRef.current;
    if (!current || current.meState !== "invited") return;
    await prepareJoinedRoom(current, "accept");
  }

  async function decline() {
    const current = callRef.current;
    if (!current) return;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }).catch(() => undefined);
    clearLocalCall();
  }

  async function hangup() {
    const current = callRef.current;
    if (!current) return;
    await apiFetch(`/api/calls/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: "leave" }) }).catch(() => undefined);
    clearLocalCall();
  }

  async function invite(profileId: ProfileId) {
    const current = callRef.current;
    if (!current) return;
    try {
      const result = await apiFetch<{ call: CallInfo | null }>(`/api/calls/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "invite", profileIds: [profileId] }),
      });
      if (result.call) setRoom(result.call);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invitation impossible");
    }
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  function toggleVideo() {
    const next = !videoOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setVideoOff(next);
  }

  async function switchCamera() {
    const current = callRef.current;
    if (!current || current.callType !== "video" || !localStreamRef.current) return;
    const nextFacing = facingMode === "user" ? "environment" : "user";
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = camera.getVideoTracks()[0];
      if (!newTrack) throw new Error("Caméra indisponible");
      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(newTrack);
      for (const entry of peersRef.current.values()) {
        const sender = entry.pc.getSenders().find((item) => item.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }
      newTrack.enabled = !videoOff;
      setFacingMode(nextFacing);
      setRemoteStreams((currentStreams) => ({ ...currentStreams }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de changer de caméra");
    }
  }

  const current = call;
  const joinedOthers = useMemo(
    () => current?.members.filter((member) => member.id !== me.id && member.state === "joined") || [],
    [current, me.id],
  );
  const inviteChoices = useMemo(() => {
    const ids = new Set(current?.members.map((member) => member.id) || []);
    return ALL_PROFILES.filter((profile) => profile.id !== me.id && !ids.has(profile.id));
  }, [current, me.id]);

  if (!current || phase === "idle") return null;

  if (phase === "incoming" || current.meState === "invited") {
    const caller = current.members.find((member) => member.id === current.createdBy);
    const group = current.members.length > 2;
    return (
      <div className={`call-overlay audio-mode incoming-call-v3`} role="dialog" aria-modal="true">
        <div className="call-panel incoming-panel-v3">
          <div className="call-pulse">
            <Avatar src={caller?.avatarUrl || profileFallback(current.createdBy)} profileId={current.createdBy} name={caller?.displayName || "Appel"} size={102} />
          </div>
          <h2>{caller?.displayName || "Appel"}</h2>
          <p>{group ? `${current.callType === "video" ? "Appel vidéo" : "Appel audio"} de groupe` : current.callType === "video" ? "Appel vidéo entrant" : "Appel audio entrant"}</p>
          {group && <div className="incoming-member-names">{current.members.filter((member) => member.id !== me.id).map((member) => member.displayName).join(" • ")}</div>}
          {error && <div className="call-error">{error}</div>}
          <div className="call-actions incoming">
            <button className="call-action decline" onClick={() => void decline()}><span>✕</span><small>Refuser</small></button>
            <button className="call-action accept" onClick={() => void accept()}><span>{current.callType === "video" ? "▰" : "📞"}</span><small>Rejoindre</small></button>
          </div>
        </div>
      </div>
    );
  }

  const title = current.startedAt ? formatTime(elapsed) : "Sonnerie…";
  const people = current.members.filter((member) => member.state === "joined" || member.state === "invited");

  return (
    <div className={`call-overlay ${current.callType === "video" ? "video-mode group-video-v3" : "audio-mode group-audio-v3"}`} role="dialog" aria-modal="true">
      {current.callType === "video" ? (
        <div className={`video-grid-v3 count-${Math.max(1, joinedOthers.length)}`}>
          {joinedOthers.length ? joinedOthers.map((member) => (
            <div key={member.id} className={`video-person-v3 ${member.online ? "online" : "away"}`}>
              {remoteStreams[member.id] && member.online
                ? <StreamVideo stream={remoteStreams[member.id]} />
                : <div className="video-away-v3"><Avatar src={member.avatarUrl} profileId={member.id} name={member.displayName} size={82} /><span>{member.online ? "Connexion…" : "A quitté l’app • reconnexion…"}</span></div>}
              <div className="video-name-v3"><strong>{member.displayName}</strong>{!member.online && <small>hors de l’app</small>}</div>
            </div>
          )) : <div className="video-person-v3 waiting"><div className="video-away-v3"><span>En attente des autres…</span></div></div>}
        </div>
      ) : (
        <div className="audio-room-v3">
          <div className="call-room-title-v3"><strong>{people.length > 2 ? "Appel de groupe" : joinedOthers[0]?.displayName || "Appel"}</strong><span>{title}</span></div>
          <div className="audio-people-v3">
            {people.map((member) => (
              <div key={member.id} className={`audio-person-v3 ${member.id === me.id ? "me" : ""} ${member.online || member.id === me.id ? "online" : "away"}`}>
                <Avatar src={member.id === me.id ? me.avatarUrl : member.avatarUrl} profileId={member.id} name={member.id === me.id ? me.displayName : member.displayName} size={76} />
                <strong>{member.id === me.id ? "Vous" : member.displayName}</strong>
                <small>{member.state === "invited" ? "Sonnerie…" : member.id === me.id ? "Dans l’appel" : member.online ? "Dans l’appel" : "A quitté l’app • reconnexion…"}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {current.callType === "video" && localStreamRef.current && (
        <div className={`local-video-card v3 ${videoOff ? "off" : ""}`}>
          <StreamVideo stream={localStreamRef.current} muted mirrored={facingMode === "user"} />
          {videoOff && <span>Caméra coupée</span>}
        </div>
      )}

      <div className="call-top-duration-v3">{title}</div>
      {joinedOthers.some((member) => !member.online) && <div className="call-away-banner-v3">Un participant a quitté l’app — l’appel reste ouvert pour sa reconnexion.</div>}
      {error && <div className="call-error floating-v3">{error}</div>}

      <div className="call-controls-v3">
        <button className={`call-action mute ${muted ? "active" : ""}`} onClick={toggleMute}><span>{muted ? "🔇" : "🎙"}</span><small>{muted ? "Réactiver" : "Muet"}</small></button>
        {current.callType === "video" && <button className={`call-action camera ${videoOff ? "active" : ""}`} onClick={toggleVideo}><span>{videoOff ? "⊘" : "▰"}</span><small>Caméra</small></button>}
        {current.callType === "video" && <button className="call-action" onClick={() => void switchCamera()}><span>↻</span><small>Retourner</small></button>}
        <button className="call-action invite" onClick={() => setShowInvite((value) => !value)}><span>＋</span><small>Inviter</small></button>
        <button className="call-action decline" onClick={() => void hangup()}><span>✕</span><small>Raccrocher</small></button>
      </div>

      {showInvite && (
        <div className="call-invite-sheet-v3">
          <div className="invite-sheet-head-v3"><strong>Inviter dans l’appel</strong><button onClick={() => setShowInvite(false)}>×</button></div>
          {inviteChoices.length ? inviteChoices.map((profile) => (
            <button key={profile.id} className="invite-person-v3" onClick={() => void invite(profile.id)}>
              <Avatar src={profileFallback(profile.id)} profileId={profile.id} name={profile.name} size={40} />
              <span>{profile.name}</span><b>Inviter</b>
            </button>
          )) : <div className="invite-empty-v3">Tout le monde est déjà dans l’appel.</div>}
        </div>
      )}

      {Object.entries(remoteStreams).map(([id, stream]) => current.callType === "audio" ? <StreamAudio key={id} stream={stream} /> : null)}
    </div>
  );
}

function StreamVideo({ stream, muted = false, mirrored = false }: { stream: MediaStream; muted?: boolean; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={mirrored ? "mirrored" : ""} />;
}

function StreamAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline hidden />;
}
