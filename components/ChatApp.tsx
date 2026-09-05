"use client";

import Image from "next/image";
import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import CreateGroupModal from "@/components/CreateGroupModal";
import SettingsModal from "@/components/SettingsModal";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/client-api";
import { getUploadClient } from "@/lib/client-supabase";
import { PROFILE_NAMES } from "@/lib/profiles";
import type { ChatMessage, Conversation, PublicProfile, UserSettings } from "@/types/chat";

const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥", "💀"];
type MeResponse = { profile: PublicProfile; settings: UserSettings };

function clock(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "G";
}

export default function ChatApp({ initialMe, initialSettings, onLoggedOut }: {
  initialMe: PublicProfile;
  initialSettings: UserSettings;
  onLoggedOut: () => void;
}) {
  const [me, setMe] = useState(initialMe);
  const [settings, setSettings] = useState(initialSettings);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId]);

  const loadMe = useCallback(async () => {
    const result = await apiFetch<MeResponse>("/api/me");
    setMe(result.profile);
    setSettings(result.settings);
  }, []);

  const loadPresence = useCallback(async () => {
    try {
      await apiFetch("/api/presence", { method: "POST", body: "{}" });
      const result = await apiFetch<{ profiles: PublicProfile[] }>("/api/presence");
      setProfiles(result.profiles);
    } catch {}
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(result.conversations);
      setActiveId((current) => current || (window.innerWidth > 760 ? result.conversations[0]?.id || null : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les discussions");
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const result = await apiFetch<{ messages: ChatMessage[] }>(`/api/conversations/${id}/messages`);
      setMessages(result.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les messages");
    }
  }, []);

  useEffect(() => {
    loadPresence();
    loadConversations();
    const a = window.setInterval(loadPresence, 20000);
    const b = window.setInterval(loadConversations, 5000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadPresence, loadConversations]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    loadMessages(activeId);
    const timer = window.setInterval(() => loadMessages(activeId), 2500);
    return () => clearInterval(timer);
  }, [activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(event?: FormEvent, media?: { path: string; name: string; type: string }) {
    event?.preventDefault();
    if (!activeId) return;
    const text = draft.trim();
    if (!text && !media) return;
    try {
      await apiFetch(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: text,
          mediaPath: media?.path || null,
          mediaName: media?.name || null,
          mediaType: media?.type || null,
          replyTo: reply?.id || null,
        }),
      });
      setDraft("");
      setReply(null);
      await Promise.all([loadMessages(activeId), loadConversations()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    }
  }

  async function upload(file?: File) {
    if (!file || !activeId) return;
    setUploading(true);
    setError("");
    try {
      const signed = await apiFetch<{ path: string; token: string }>("/api/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size, kind: "message" }),
      });
      const result = await getUploadClient().storage.from("private-media").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream" });
      if (result.error) throw result.error;
      await send(undefined, { path: signed.path, name: file.name, type: file.type || "application/octet-stream" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload impossible");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (gifRef.current) gifRef.current.value = "";
    }
  }

  async function react(id: string, emoji: string) {
    try {
      await apiFetch(`/api/messages/${id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
      setReactionFor(null);
      if (activeId) await loadMessages(activeId);
    } catch (e) { setError(e instanceof Error ? e.message : "Réaction impossible"); }
  }

  async function saveEdit() {
    if (!editing || !activeId) return;
    try {
      await apiFetch(`/api/messages/${editing.id}`, { method: "PATCH", body: JSON.stringify({ content: draft }) });
      setEditing(null); setDraft("");
      await loadMessages(activeId);
    } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible"); }
  }

  async function remove(message: ChatMessage) {
    if (!confirm("Supprimer ce message ?") || !activeId) return;
    try {
      await apiFetch(`/api/messages/${message.id}`, { method: "DELETE" });
      await loadMessages(activeId);
    } catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); }
  }

  async function forward(conversationId: string) {
    if (!forwarding) return;
    try {
      await apiFetch(`/api/messages/${forwarding.id}/forward`, { method: "POST", body: JSON.stringify({ conversationId }) });
      setForwarding(null);
      await loadConversations();
      setActiveId(conversationId);
    } catch (e) { setError(e instanceof Error ? e.message : "Transfert impossible"); }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    onLoggedOut();
  }

  const style = { "--accent": settings.accent, "--font-scale": String(settings.fontScale) } as CSSProperties;
  const activeOther = active?.type === "dm" ? active.members.find((m) => m.id !== me.id) : null;
  const activeOtherOnline = activeOther ? profiles.find((p) => p.id === activeOther.id)?.online : false;

  return (
    <main className={`chat-app theme-${settings.theme}`} style={style}>
      <aside className={`sidebar ${activeId ? "mobile-hidden" : ""}`}>
        <div className="sidebar-head">
          <button className="identity" onClick={() => setShowSettings(true)}>
            <Avatar src={me.avatarUrl} profileId={me.id} name={me.displayName} size={42} online />
            <span><strong>{me.displayName}</strong><small>Paramètres</small></span>
          </button>
          <button className="new-group" onClick={() => setShowGroup(true)}>＋</button>
        </div>
        <div className="conversation-list">
          {conversations.map((conversation) => {
            const other = conversation.type === "dm" ? conversation.members.find((m) => m.id !== me.id) : null;
            const online = other ? profiles.find((p) => p.id === other.id)?.online : undefined;
            return (
              <button key={conversation.id} className={`conversation-item ${conversation.id === activeId ? "active" : ""}`} onClick={() => setActiveId(conversation.id)}>
                {other ? <Avatar src={other.avatarUrl} profileId={other.id} name={other.displayName} size={46} online={online} /> : <span className="group-avatar">{initials(conversation.title)}</span>}
                <span className="conversation-copy">
                  <span className="conversation-line"><strong>{conversation.title}</strong>{conversation.lastMessage && <time>{clock(conversation.lastMessage.createdAt)}</time>}</span>
                  <span className="conversation-preview">{conversation.lastMessage?.content || "Aucun message"}</span>
                </span>
                {conversation.unreadCount > 0 && <span className="badge">{conversation.unreadCount}</span>}
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`chat-pane ${!activeId ? "mobile-hidden" : ""}`}>
        {!active ? <div className="empty-chat">Choisis une discussion.</div> : <>
          <header className="chat-head">
            <button className="back" onClick={() => setActiveId(null)}>‹</button>
            {activeOther ? <Avatar src={activeOther.avatarUrl} profileId={activeOther.id} name={activeOther.displayName} size={40} online={activeOtherOnline} /> : <span className="group-avatar small">{initials(active.title)}</span>}
            <span className="chat-head-copy"><strong>{active.title}</strong><small>{active.type === "dm" ? (activeOtherOnline ? "En ligne" : "Hors ligne") : `${active.members.length} membres`}</small></span>
          </header>

          <div className="messages">
            {messages.length === 0 && <div className="empty-chat">Aucun message pour l’instant.</div>}
            {messages.map((message) => {
              const mine = message.senderId === me.id;
              const readers = message.readBy.filter((id) => id !== me.id);
              return <article key={message.id} className={`message ${mine ? "mine" : ""}`}>
                <Avatar src={message.senderAvatarUrl} profileId={message.senderId} name={message.senderName} size={34} />
                <div className="message-body">
                  <div className="message-meta"><strong>{message.senderName}</strong><time>{clock(message.createdAt)}</time></div>
                  <div className={`bubble ${message.deletedAt ? "deleted" : ""}`}>
                    {message.deletedAt ? <em>Message supprimé</em> : <>
                      {message.forwarded && <small className="forwarded">↗ Transféré</small>}
                      {message.replyTo && <div className="reply-box"><strong>{message.replyTo.senderName}</strong><span>{message.replyTo.content || "Média"}</span></div>}
                      {message.content && <div className="message-text">{message.content}</div>}
                      {message.mediaUrl && <Media message={message} />}
                      {message.editedAt && <small className="edited">modifié</small>}
                    </>}
                  </div>
                  {!message.deletedAt && <div className="message-actions">
                    <button onClick={() => { setReply(message); setEditing(null); }}>↩</button>
                    <button onClick={() => setReactionFor(reactionFor === message.id ? null : message.id)}>☺</button>
                    <button onClick={() => setForwarding(message)}>↗</button>
                    {mine && <button onClick={() => { setEditing(message); setReply(null); setDraft(message.content); }}>✎</button>}
                    {mine && <button onClick={() => remove(message)}>⌫</button>}
                  </div>}
                  {reactionFor === message.id && <div className="reaction-picker">{REACTIONS.map((emoji) => <button key={emoji} onClick={() => react(message.id, emoji)}>{emoji}</button>)}</div>}
                  {message.reactions.length > 0 && <div className="reaction-row">{message.reactions.map((r) => <button key={r.emoji} className={r.profileIds.includes(me.id) ? "selected" : ""} onClick={() => react(message.id, r.emoji)}>{r.emoji} {r.profileIds.length}</button>)}</div>}
                  {mine && readers.length > 0 && <div className="seen">Vu par {readers.map((id) => PROFILE_NAMES[id]).join(", ")}</div>}
                </div>
              </article>;
            })}
            <div ref={endRef} />
          </div>

          <div className="composer-wrap">
            {error && <button className="error-bar" onClick={() => setError("")}>{error} ×</button>}
            {(reply || editing) && <div className="composer-context"><span><strong>{editing ? "Modification" : `Réponse à ${reply?.senderName}`}</strong><small>{editing?.content || reply?.content || "Média"}</small></span><button onClick={() => { setReply(null); setEditing(null); setDraft(""); }}>×</button></div>}
            <form className="composer" onSubmit={editing ? (e) => { e.preventDefault(); saveEdit(); } : send}>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>＋</button>
              <input hidden ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.doc,.docx" onChange={(e) => upload(e.target.files?.[0])} />
              <button type="button" className="gif" onClick={() => gifRef.current?.click()} disabled={uploading}>GIF</button>
              <input hidden ref={gifRef} type="file" accept="image/gif" onChange={(e) => upload(e.target.files?.[0])} />
              <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={uploading ? "Envoi…" : "Écrire un message"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); editing ? saveEdit() : send(); } }} />
              <button className="send" type="submit">➤</button>
            </form>
          </div>
        </>}
      </section>

      {showGroup && <CreateGroupModal me={me.id} profiles={profiles} onClose={() => setShowGroup(false)} onCreated={async (id) => { setShowGroup(false); await loadConversations(); setActiveId(id); }} />}
      {showSettings && <SettingsModal me={me} settings={settings} profiles={profiles} onClose={() => setShowSettings(false)} onSettings={setSettings} onAvatarChanged={async () => { await Promise.all([loadMe(), loadPresence(), loadConversations()]); }} onLogout={logout} />}
      {forwarding && <Modal onClose={() => setForwarding(null)}><div className="modal-title-row"><h2>Transférer vers</h2><button className="icon-button" onClick={() => setForwarding(null)}>×</button></div><div className="forward-list">{conversations.map((c) => <button key={c.id} onClick={() => forward(c.id)}><span>{c.title}</span></button>)}</div></Modal>}
    </main>
  );
}

function Media({ message }: { message: ChatMessage }) {
  const url = message.mediaUrl!;
  const type = message.mediaType || "";
  if (type.startsWith("image/")) return <a href={url} target="_blank" rel="noreferrer"><Image className="message-image" src={url} alt={message.mediaName || "Image"} width={640} height={480} unoptimized /></a>;
  if (type.startsWith("video/")) return <video className="message-video" controls playsInline src={url} />;
  if (type.startsWith("audio/")) return <audio controls src={url} />;
  return <a className="file-card" href={`${url}?download=1`} target="_blank" rel="noreferrer"><span>↧</span><strong>{message.mediaName || "Fichier"}</strong></a>;
}
