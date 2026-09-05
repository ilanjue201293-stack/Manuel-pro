"use client";

import { useCallback, useEffect, useState } from "react";
import ChatApp from "@/components/ChatApp";
import LoginScreen from "@/components/LoginScreen";
import { apiFetch } from "@/lib/client-api";
import type { PublicProfile, UserSettings } from "@/types/chat";

type MeResponse = { profile: PublicProfile; settings: UserSettings };

export default function RootApp() {
  const [state, setState] = useState<"loading" | "login" | "chat">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);

  const check = useCallback(async () => {
    try {
      const response = await apiFetch<MeResponse>("/api/me");
      setMe(response);
      setState("chat");
    } catch {
      setMe(null);
      setState("login");
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  if (state === "loading") return <main className="loading-page"><span className="loading-dot" /></main>;
  if (state === "login" || !me) return <LoginScreen onLoggedIn={check} />;
  return <ChatApp initialMe={me.profile} initialSettings={me.settings} onLoggedOut={() => { setMe(null); setState("login"); }} />;
}
