"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/client-api";
import type { PublicProfile, ProfileId } from "@/types/chat";

export default function CreateGroupModal({
  me,
  profiles,
  onClose,
  onCreated,
}: {
  me: ProfileId;
  profiles: PublicProfile[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<ProfileId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: ProfileId) {
    setMembers((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function create() {
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title, members }),
      });
      onCreated(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-title-row">
        <h2>Nouveau groupe</h2>
        <button className="icon-button" onClick={onClose}>×</button>
      </div>
      <label className="field-label">Nom</label>
      <input className="text-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nom du groupe" maxLength={50} autoFocus />
      <div className="member-picker">
        {profiles.filter((p) => p.id !== me).map((profile) => (
          <button key={profile.id} className={`member-choice ${members.includes(profile.id) ? "selected" : ""}`} onClick={() => toggle(profile.id)}>
            <Avatar src={profile.avatarUrl} profileId={profile.id} name={profile.displayName} size={38} online={profile.online} />
            <span>{profile.displayName}</span>
            <span className="member-check">{members.includes(profile.id) ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="button ghost" onClick={onClose}>Annuler</button>
        <button className="button primary" onClick={create} disabled={loading || !title.trim() || members.length === 0}>
          {loading ? "Création…" : "Créer"}
        </button>
      </div>
    </Modal>
  );
}
