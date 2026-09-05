import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, PROFILE_NAMES } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;

  const supabase = getSupabaseAdmin();
  const [{ data: profile, error: profileError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_path").eq("id", auth.profileId).single(),
    supabase.from("profile_settings").select("accent, font_scale, theme").eq("profile_id", auth.profileId).single(),
  ]);

  if (profileError || settingsError) {
    return NextResponse.json({ error: "Base de données non initialisée" }, { status: 500 });
  }

  return NextResponse.json({
    profile: {
      id: auth.profileId,
      displayName: profile?.display_name || PROFILE_NAMES[auth.profileId],
      avatarUrl: profile?.avatar_path ? `/api/avatar/${auth.profileId}?v=${encodeURIComponent(profile.avatar_path)}` : fallbackAvatar(auth.profileId),
    },
    settings: {
      accent: settings?.accent || "#6d5efc",
      fontScale: Number(settings?.font_scale || 1),
      theme: settings?.theme || "dark",
    },
  });
}
