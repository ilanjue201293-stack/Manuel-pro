"use client";

import Image from "next/image";
import { CSSProperties, FormEvent, useCallback, useMemo, useRef, useState, useEffect } from "react";
import Avatar from "@/components/Avatar";
import CreateGroupModal from "@/components/CreateGroupModal";
import SettingsModal from "@/components/SettingsModal";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/client-api";
import { getUploadClient } from "@/lib/client-supabase";
import type { ChatMessage, Conversation, MessageAttachment, PublicProfile, UserSettings } from "@/types/chat";

const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥", "💀"];
const GROUP_WINDOW = 5 * 60 * 1000;
type MeResponse = { profile: PublicProfile; settings: UserSettings };
type MediaPayload = { path: string; name: string; type: string };
type PendingItem = { id: string; file: File; url: string };

function clock(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "G";
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function closeInTime(a?: ChatMessage, b?: ChatMessage) {
  if (!a || !b || a.senderId !== b.senderId) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_WINDOW;
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
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => conversations.find((conversation) => conversation.id === activeId) || null, [conversations, activeId]);

  const loadMe = useCallback(async () => {
    const result = await apiFetch<MeResponse>("/api/me");
    setMe((current) => sameJson(current, result.profile) ? current : result.profile);
    setSettings((current) => sameJson(current, result.settings) ? current : result.settings);
  }, []);

  const loadPresence = useCallback(async () => {
    try {
      await apiFetch("/api/presence", { method: "POST", body: "{}" });
      const result = await apiFetch<{ profiles: PublicProfile[] }>("/api/presence");
      setProfiles((current) => sameJson(current, result.profiles) ? current : result.profiles);
    } catch {}
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
      setConversations((current) => sameJson(current, result.conversations) ? current : result.conversations);
      setActiveId((current) => current || (window.innerWidth > 760 ? result.conversations[0]?.id || null : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les discussions");
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const result = await apiFetch<{ messages: ChatMessage[] }>(`/api/conversations/${id}/messages`);
      setMessages((current) => sameJson(current, result.messages) ? current : result.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les messages");
    }
  }, []);

  useEffect(() => {
    void loadPresence();
    void loadConversations();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadPresence();
      void loadConversations();
    };
    const presenceTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPresence();
    }, 20000);
    const conversationTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversations();
    }, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(presenceTimer);
      window.clearInterval(conversationTimer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadConversations, loadPresence]);

  useEffect(() => {
    setActionsFor(null);
    setReactionFor(null);
    setReply(null);
    setEditing(null);
    if (!activeId) { setMessages([]); return; }
    void loadMessages(activeId).then(() => window.setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 40));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages(activeId);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (!conversations.length) return;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("conversation");
    if (requested && conversations.some((conversation) => conversation.id === requested)) {
      setActiveId(requested);
      url.searchParams.delete("conversation");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [conversations]);

  useEffect(() => {
    const total = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
    const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (total > 0) nav.setAppBadge?.(total).catch(() => undefined);
    else nav.clearAppBadge?.().catch(() => undefined);
  }, [conversations]);

  useEffect(() => {
    if (!messages.length) return;
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }, [messages.length]);

  useEffect(() => () => {
    pending.forEach((item) => URL.revokeObjectURL(item.url));
  }, [pending]);

  function clearPending() {
    setPending((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url));
      return [];
    });
    if (fileRef.current) fileRef.current.value = "";
    if (gifRef.current) gifRef.current.value = "";
  }

  function addFiles(files?: FileList | File[]) {
    if (!files) return;
    setError("");
    const incoming = Array.from(files);
    setPending((current) => {
      const room = Math.max(0, 10 - current.length);
      const accepted: PendingItem[] = [];
      for (const file of incoming.slice(0, room)) {
        if (file.size > 50 * 1024 * 1024) {
          setError(`${file.name} dépasse 50 Mo`);
          continue;
        }
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          url: URL.createObjectURL(file),
        });
      }
      if (incoming.length > room) setError("Maximum 10 médias par message");
      return [...current, ...accepted];
    });
  }

  function removePending(id: string) {
    setPending((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadSelected(file: File): Promise<MediaPayload> {
    const signed = await apiFetch<{ path: string; token: string }>("/api/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size, kind: "message" }),
    });
    const result = await getUploadClient().storage.from("private-media").uploadToSignedUrl(
      signed.path,
      signed.token,
      file,
      { contentType: file.type || "application/octet-stream" },
    );
    if (result.error) throw result.error;
    return { path: signed.path, name: file.name, type: file.type || "application/octet-stream" };
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!activeId || sending) return;
    const text = draft.trim();
    if (!text && !pending.length) return;
    setSending(true);
    setError("");
    try {
      const media: MediaPayload[] = [];
      for (const item of pending) media.push(await uploadSelected(item.file));
      await apiFetch(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text, media, replyTo: reply?.id || null }),
      });
      setDraft("");
      setReply(null);
      clearPending();
      await Promise.all([loadMessages(activeId), loadConversations()]);
      window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setSending(false);
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
      setEditing(null);
      setDraft("");
      await loadMessages(activeId);
    } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible"); }
  }

  async function remove(message: ChatMessage) {
    if (!confirm("Supprimer ce message ?") || !activeId) return;
    try {
      await apiFetch(`/api/messages/${message.id}`, { method: "DELETE" });
      setActionsFor(null);
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
  const activeOther = active?.type === "dm" ? active.members.find((member) => member.id !== me.id) : null;
  const activeOtherOnline = activeOther ? profiles.find((profile) => profile.id === activeOther.id)?.online : false;

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
            const other = conversation.type === "dm" ? conversation.members.find((member) => member.id !== me.id) : null;
            const online = other ? profiles.find((profile) => profile.id === other.id)?.online : undefined;
            return (
              <button key={conversation.id} className={`conversation-item ${conversation.id === activeId ? "active" : ""}`} onClick={() => setActiveId(conversation.id)}>
                {other ? <Avatar src={other.avatarUrl} profileId={other.id} name={other.displayName} size={46} online={online} /> : <span className="group-avatar">{initials(conversation.title)}</span>}
                <span className="conversation-copy">
                  <span className="conversation-line"><strong>{conversation.title}</strong>{conversation.lastMessage && <time>{clock(conversation.lastMessage.createdAt)}</time>}</span>
                  <span className="conversation-preview">{conversation.lastMessage?.content || (conversation.lastMessage ? "📎 Média" : "Aucun message")}</span>
                </span>
                {conversation.unreadCount > 0 && <span className="badge">{conversation.unreadCount}</span>}
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`chat-pane ${!activeId ? "mobile-hidden" : ""}`}>
        {!active ? <div className="empty-chat">Choisis une discussion.</div> : <>
          <header className="chat-head" data-conversation-id={active.id} data-conversation-type={active.type}>
            <button className="back" onClick={() => setActiveId(null)}>‹</button>
            {activeOther ? <Avatar src={activeOther.avatarUrl} profileId={activeOther.id} name={activeOther.displayName} size={40} online={activeOtherOnline} /> : <span className="group-avatar small">{initials(active.title)}</span>}
            <span className="chat-head-copy">
              <strong>{active.title}</strong>
              <small>{active.type === "dm" ? (activeOtherOnline ? "En ligne" : "Hors ligne") : `${active.members.length} membres`}</small>
            </span>
          </header>

          <div className="messages" onClick={(event) => {
            if (event.target === event.currentTarget) { setActionsFor(null); setReactionFor(null); }
          }}>
            {messages.length === 0 && <div className="empty-chat">Aucun message pour l’instant.</div>}
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const next = messages[index + 1];
              const groupedPrev = closeInTime(previous, message);
              const groupedNext = closeInTime(message, next);
              const mine = message.senderId === me.id;
              const readers = message.readBy.filter((id) => id !== me.id);
              const showSeen = mine && readers.length > 0 && !groupedNext;
              const openActions = actionsFor === message.id;
              const attachments = message.attachments?.length
                ? message.attachments
                : message.mediaUrl ? [{ id: `legacy-${message.id}`, url: message.mediaUrl, name: message.mediaName || "Fichier", type: message.mediaType || "application/octet-stream" }] : [];

              return (
                <article key={message.id} className={`message message-v3 ${mine ? "mine" : ""} ${groupedPrev ? "grouped-prev" : "group-start"} ${groupedNext ? "grouped-next" : "group-end"}`}>
                  <div className="message-avatar-col-v3">
                    {!groupedPrev && <Avatar src={message.senderAvatarUrl} profileId={message.senderId} name={message.senderName} size={34} />}
                  </div>
                  <div className="message-body">
                    {!groupedPrev && <div className="message-meta"><strong>{message.senderName}</strong><time>{clock(message.createdAt)}</time></div>}
                    <div className="message-line-v3">
                      <div className={`bubble ${message.deletedAt ? "deleted" : ""}`} onDoubleClick={() => !message.deletedAt && setReactionFor(message.id)}>
                        {message.deletedAt ? <em>Message supprimé</em> : <>
                          {message.forwarded && <small className="forwarded">↗ Transféré</small>}
                          {message.replyTo && <div className="reply-box"><strong>{message.replyTo.senderName}</strong><span>{message.replyTo.content || "Média"}</span></div>}
                          {message.content && <div className="message-text">{message.content}</div>}
                          {attachments.length > 0 && <AttachmentGrid attachments={attachments} />}
                          {message.editedAt && <small className="edited">modifié</small>}
                        </>}
                      </div>
                      {showSeen && <span className="seen-inline-v3">Vu</span>}
                      {!message.deletedAt && <button className="message-more-v3" aria-label="Actions" onClick={() => { setActionsFor(openActions ? null : message.id); setReactionFor(null); }}>•••</button>}
                      {openActions && <div className="message-actions-v3">
                        <button onClick={() => { setReply(message); setEditing(null); setActionsFor(null); }}>↩ <span>Répondre</span></button>
                        <button onClick={() => setReactionFor(reactionFor === message.id ? null : message.id)}>☺ <span>Réagir</span></button>
                        <button onClick={() => { setForwarding(message); setActionsFor(null); }}>↗ <span>Transférer</span></button>
                        {mine && <button onClick={() => { setEditing(message); setReply(null); setDraft(message.content); clearPending(); setActionsFor(null); }}>✎ <span>Modifier</span></button>}
                        {mine && <button className="danger" onClick={() => void remove(message)}>⌫ <span>Supprimer</span></button>}
                      </div>}
                    </div>
                    {reactionFor === message.id && <div className="reaction-picker v3">{REACTIONS.map((emoji) => <button key={emoji} onClick={() => void react(message.id, emoji)}>{emoji}</button>)}</div>}
                    {message.reactions.length > 0 && <div className="reaction-row compact-v3">{message.reactions.map((reaction) => <button key={reaction.emoji} className={reaction.profileIds.includes(me.id) ? "selected" : ""} onClick={() => void react(message.id, reaction.emoji)}>{reaction.emoji} {reaction.profileIds.length}</button>)}</div>}
                  </div>
                </article>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="composer-wrap">
            {error && <button className="error-bar" onClick={() => setError("")}>{error} ×</button>}
            {(reply || editing) && <div className="composer-context"><span><strong>{editing ? "Modification" : `Réponse à ${reply?.senderName}`}</strong><small>{editing?.content || reply?.content || "Média"}</small></span><button onClick={() => { setReply(null); setEditing(null); setDraft(""); }}>×</button></div>}
            {pending.length > 0 && !editing && <PendingGrid items={pending} onRemove={removePending} />}
            <form className="composer" onSubmit={editing ? (event) => { event.preventDefault(); void saveEdit(); } : send}>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={sending || Boolean(editing)}>＋</button>
              <input data-media-input="true" hidden multiple ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.doc,.docx" onChange={(event) => { addFiles(event.target.files || undefined); event.target.value = ""; }} />
              <button type="button" className="gif" onClick={() => gifRef.current?.click()} disabled={sending || Boolean(editing)}>GIF</button>
              <input hidden multiple ref={gifRef} type="file" accept="image/gif" onChange={(event) => { addFiles(event.target.files || undefined); event.target.value = ""; }} />
              <textarea rows={1} value={draft} onFocus={() => window.setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 80)} onChange={(event) => setDraft(event.target.value)} placeholder={sending ? "Envoi…" : pending.length ? "Ajouter un message…" : "Écrire un message"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); editing ? void saveEdit() : void send(); } }} />
              <button className="send" type="submit" disabled={sending}>{sending ? "…" : "➤"}</button>
            </form>
          </div>
        </>}
      </section>

      {showGroup && <CreateGroupModal me={me.id} profiles={profiles} onClose={() => setShowGroup(false)} onCreated={async (id) => { setShowGroup(false); await loadConversations(); setActiveId(id); }} />}
      {showSettings && <SettingsModal me={me} settings={settings} profiles={profiles} onClose={() => setShowSettings(false)} onSettings={setSettings} onAvatarChanged={async () => { await Promise.all([loadMe(), loadPresence(), loadConversations()]); }} onLogout={logout} />}
      {forwarding && <Modal onClose={() => setForwarding(null)}><div className="modal-title-row"><h2>Transférer vers</h2><button className="icon-button" onClick={() => setForwarding(null)}>×</button></div><div className="forward-list">{conversations.map((conversation) => <button key={conversation.id} onClick={() => void forward(conversation.id)}><span>{conversation.title}</span></button>)}</div></Modal>}
    </main>
  );
}

function PendingGrid({ items, onRemove }: { items: PendingItem[]; onRemove: (id: string) => void }) {
  return <div className={`pending-grid-v3 count-${Math.min(items.length, 4)}`}>
    {items.map((item) => <div key={item.id} className="pending-card-v3">
      {item.file.type.startsWith("image/") ? <img src={item.url} alt="Aperçu" /> : item.file.type.startsWith("video/") ? <video src={item.url} muted playsInline /> : <div className="pending-file-icon-v3">{item.file.type.startsWith("audio/") ? "🎙" : "📎"}</div>}
      <span>{item.file.name}</span>
      <button type="button" onClick={() => onRemove(item.id)} aria-label="Retirer">×</button>
    </div>)}
  </div>;
}

function AttachmentGrid({ attachments }: { attachments: MessageAttachment[] }) {
  const visual = attachments.filter((attachment) => attachment.type.startsWith("image/") || attachment.type.startsWith("video/"));
  const others = attachments.filter((attachment) => !attachment.type.startsWith("image/") && !attachment.type.startsWith("video/"));
  return <>
    {visual.length > 0 && <div className={`attachment-grid-v3 count-${Math.min(visual.length, 4)}`}>
      {visual.map((attachment) => attachment.type.startsWith("image/")
        ? <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="attachment-visual-v3"><Image src={attachment.url} alt={attachment.name} width={700} height={560} unoptimized /></a>
        : <div key={attachment.id} className="attachment-visual-v3"><video controls playsInline src={attachment.url} /></div>)}
    </div>}
    {others.map((attachment) => attachment.type.startsWith("audio/")
      ? <audio key={attachment.id} controls src={attachment.url} />
      : <a key={attachment.id} className="file-card" href={`${attachment.url}?download=1`} target="_blank" rel="noreferrer"><span>↧</span><strong>{attachment.name}</strong></a>)}
  </>;
}
