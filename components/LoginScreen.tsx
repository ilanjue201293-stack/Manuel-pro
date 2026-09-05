"use client";

import { FormEvent, useState } from "react";
import Avatar from "@/components/Avatar";
import { PROFILE_IDS, PROFILE_NAMES } from "@/lib/profiles";
import { apiFetch } from "@/lib/client-api";
import type { ProfileId } from "@/types/chat";

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [selected, setSelected] = useState<ProfileId | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!selected || !password) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ profileId: selected, password }),
      });
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion impossible");
    } finally {
      setLoading(false);
    }
  }

  function choose(id: ProfileId) {
    setSelected(id);
    setPassword("");
    setError("");
  }

  return (
    <main className="login-page">
      <div className="profiles-grid" aria-label="Choisir un profil">
        {PROFILE_IDS.map((id) => (
          <button className="profile-card" key={id} onClick={() => choose(id)}>
            <Avatar src={`/api/avatar/${id}`} profileId={id} name={PROFILE_NAMES[id]} size={112} />
            <span>{PROFILE_NAMES[id]}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <form className="password-modal" onSubmit={login} onMouseDown={(e) => e.stopPropagation()}>
            <Avatar src={`/api/avatar/${selected}`} profileId={selected} name={PROFILE_NAMES[selected]} size={74} />
            <div className="password-name">{PROFILE_NAMES[selected]}</div>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setSelected(null)}>Annuler</button>
              <button type="submit" className="button primary" disabled={loading || !password}>
                {loading ? "Connexion…" : "Confirmer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
