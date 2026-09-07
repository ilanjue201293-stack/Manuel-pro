"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/client-api";
import { getUploadClient } from "@/lib/client-supabase";
import type { Conversation, ProfileId } from "@/types/chat";

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "G";
}

export default function GroupSettingsModal({
  conversation,
  me,
  onClose,
  onUpdated,
  onDeleted,
}: {
  conversation: Conversation;
  me: ProfileId;
  onClose: () => void;
  onUpdated: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === conversation.title) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: next }),
      });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally { setBusy(false); }
  }

  async function changePhoto(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const signed = await apiFetch<{ path: string; token: string }>("/api/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, kind: "group-avatar" }),
      });
      const upload = await getUploadClient().storage.from("private-media").uploadToSignedUrl(
        signed.path,
        signed.token,
        file,
        { contentType: file.type },
      );
      if (upload.error) throw upload.error;
      await apiFetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ imagePath: signed.path }),
      });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo impossible à modifier");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ removeImage: true }) });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de retirer la photo");
    } finally { setBusy(false); }
  }

  async function removeMember(profileId: ProfileId, name: string) {
    if (!confirm(`Retirer ${name} du groupe ?`)) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeMember: profileId }),
      });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de retirer ce membre");
    } finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!confirm(`Supprimer définitivement le groupe « ${conversation.title} » ?`)) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} className="group-settings-modal-v7">
      <div className="modal-title-row">
        <h2>Groupe</h2>
        <button className="icon-button" onClick={onClose}>×</button>
      </div>

      <div className="group-settings-hero-v7">
        <button className="group-photo-button-v7" onClick={() => fileRef.current?.click()} disabled={busy}>
          {conversation.avatarUrl ? <img src={conversation.avatarUrl} alt="Photo du groupe" /> : <span>{initials(conversation.title)}</span>}
          <b>📷</b>
        </button>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => void changePhoto(e.target.files?.[0])} />
        <div className="group-photo-actions-v7">
          <button className="link-button" onClick={() => fileRef.current?.click()} disabled={busy}>Changer la photo</button>
          {conversation.avatarUrl && <button className="link-button danger-text-v7" onClick={() => void removePhoto()} disabled={busy}>Retirer</button>}
        </div>
      </div>

      <label className="field-label">Nom du groupe</label>
      <div className="group-name-row-v7">
        <input className="text-field" value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} />
        <button className="button primary" disabled={busy || !title.trim() || title.trim() === conversation.title} onClick={() => void saveTitle()}>Enregistrer</button>
      </div>

      <div className="settings-label group-members-title-v7">Membres</div>
      <div className="group-members-v7">
        {conversation.members.map((member) => (
          <div className="group-member-v7" key={member.id}>
            <Avatar src={member.avatarUrl} profileId={member.id} name={member.displayName} size={38} online={member.online} />
            <span><strong>{member.displayName}</strong>{member.id === me && <small>Vous</small>}</span>
            {member.id !== me && conversation.members.length > 2 && (
              <button className="remove-member-v7" disabled={busy} onClick={() => void removeMember(member.id, member.displayName)}>Retirer</button>
            )}
          </div>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}
      <button className="button danger full delete-group-v7" disabled={busy} onClick={() => void deleteGroup()}>Supprimer le groupe</button>
    </Modal>
  );
}
