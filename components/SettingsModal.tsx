"use client";

import { useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import NotificationSettings from "@/components/NotificationSettings";
import { apiFetch } from "@/lib/client-api";
import { getUploadClient } from "@/lib/client-supabase";
import type { PublicProfile, UserSettings } from "@/types/chat";

const ACCENTS = ["#6d5efc", "#2f80ed", "#16a085", "#e056fd", "#e67e22", "#e74c3c"];

export default function SettingsModal({
  me,
  settings,
  profiles,
  onClose,
  onSettings,
  onAvatarChanged,
  onLogout,
}: {
  me: PublicProfile;
  settings: UserSettings;
  profiles: PublicProfile[];
  onClose: () => void;
  onSettings: (settings: UserSettings) => void;
  onAvatarChanged: () => void;
  onLogout: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function patch(next: Partial<UserSettings>) {
    const merged = { ...settings, ...next };
    onSettings(merged);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify(next) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sauvegarde impossible");
    }
  }

  async function changeAvatar(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const signed = await apiFetch<{ path: string; token: string }>("/api/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, kind: "avatar" }),
      });
      const upload = await getUploadClient().storage.from("private-media").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
      if (upload.error) throw upload.error;
      await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ avatarPath: signed.path }) });
      onAvatarChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo impossible à envoyer");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Modal onClose={onClose} className="settings-modal">
      <div className="modal-title-row">
        <h2>Paramètres</h2>
        <button className="icon-button" onClick={onClose}>×</button>
      </div>

      <section className="settings-section profile-setting-row">
        <Avatar src={me.avatarUrl} profileId={me.id} name={me.displayName} size={68} online />
        <div>
          <strong>{me.displayName}</strong>
          <button className="link-button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Envoi…" : "Changer la photo"}
          </button>
          <input ref={inputRef} hidden type="file" accept="image/*" onChange={(e) => changeAvatar(e.target.files?.[0])} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label">Couleur</div>
        <div className="accent-row">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              aria-label={accent}
              className={`accent-swatch ${settings.accent === accent ? "active" : ""}`}
              style={{ background: accent }}
              onClick={() => patch({ accent })}
            />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label">Taille du texte</div>
        <div className="font-size-row">
          <span>A</span>
          <input
            type="range"
            min="0.85"
            max="1.3"
            step="0.05"
            value={settings.fontScale}
            onChange={(e) => patch({ fontScale: Number(e.target.value) })}
          />
          <span className="big-a">A</span>
        </div>
      </section>

      <section className="settings-section theme-row">
        <div>
          <div className="settings-label">Apparence</div>
          <div className="settings-hint">Clair ou sombre</div>
        </div>
        <div className="segmented">
          <button className={settings.theme === "dark" ? "active" : ""} onClick={() => patch({ theme: "dark" })}>Sombre</button>
          <button className={settings.theme === "light" ? "active" : ""} onClick={() => patch({ theme: "light" })}>Clair</button>
        </div>
      </section>

      <NotificationSettings />

      <section className="settings-section">
        <div className="settings-label">Connectés</div>
        <div className="online-list">
          {profiles.map((profile) => (
            <div key={profile.id} className="online-person">
              <Avatar src={profile.avatarUrl} profileId={profile.id} name={profile.displayName} size={32} online={profile.online} />
              <span>{profile.displayName}</span>
              <span className="online-text">{profile.online ? "En ligne" : "Hors ligne"}</span>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="form-error">{error}</div>}
      <button className="button danger full" onClick={onLogout}>Se déconnecter</button>
    </Modal>
  );
}
