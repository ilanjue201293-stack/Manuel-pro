import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, PROFILE_IDS, PROFILE_NAMES } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("presence")
    .upsert({ profile_id: auth.profileId, last_seen: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const supabase = getSupabaseAdmin();
  const [{ data: presence, error: pError }, { data: profiles, error: uError }] = await Promise.all([
    supabase.from("presence").select("profile_id, last_seen"),
    supabase.from("profiles").select("id, display_name, avatar_path"),
  ]);
  if (pError || uError) return NextResponse.json({ error: "Erreur présence" }, { status: 500 });

  const threshold = Date.now() - 45_000;
  const pmap = new Map<ProfileId, number>((presence || []).filter((p: any) => PROFILE_IDS.includes(p.profile_id as ProfileId)).map((p: any) => [p.profile_id as ProfileId, new Date(p.last_seen).getTime()]));
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

  return NextResponse.json({
    profiles: PROFILE_IDS.map((id: ProfileId) => {
      const row: any = profileMap.get(id);
      return {
        id,
        displayName: row?.display_name || PROFILE_NAMES[id],
        avatarUrl: row?.avatar_path ? `/api/avatar/${id}?v=${encodeURIComponent(row.avatar_path)}` : fallbackAvatar(id),
        online: id === auth.profileId || (pmap.get(id) || 0) > threshold,
      };
    }),
  });
}
