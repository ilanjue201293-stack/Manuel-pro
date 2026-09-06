import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, isProfileId, PROFILE_NAMES } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendCallPush } from "@/lib/push";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatCall(row: any, me: ProfileId) {
  if (!row) return null;
  const otherId = (row.caller_id === me ? row.callee_id : row.caller_id) as ProfileId;
  return {
    id: row.id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    status: row.status,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    other: {
      id: otherId,
      displayName: PROFILE_NAMES[otherId],
      avatarUrl: fallbackAvatar(otherId),
    },
  };
}

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id,caller_id,callee_id,status,created_at,answered_at,ended_at")
    .or(`caller_id.eq.${auth.profileId},callee_id.eq.${auth.profileId}`)
    .in("status", ["ringing", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ call: null });

  if (data.status === "ringing" && Date.now() - new Date(data.created_at).getTime() > 60_000) {
    await supabase.from("call_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", data.id);
    return NextResponse.json({ call: null });
  }

  return NextResponse.json({ call: formatCall(data, auth.profileId) });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const body = await request.json().catch(() => ({}));
  const calleeId = body?.calleeId;
  if (!isProfileId(calleeId) || calleeId === auth.profileId) {
    return NextResponse.json({ error: "Destinataire invalide" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: busy } = await supabase
    .from("call_sessions")
    .select("id")
    .or(`caller_id.eq.${auth.profileId},callee_id.eq.${auth.profileId},caller_id.eq.${calleeId},callee_id.eq.${calleeId}`)
    .in("status", ["ringing", "accepted"])
    .limit(1);

  if (busy?.length) return NextResponse.json({ error: "L’un de vous est déjà en appel" }, { status: 409 });

  const { data, error } = await supabase.from("call_sessions").insert({
    caller_id: auth.profileId,
    callee_id: calleeId,
    status: "ringing",
  }).select("id,caller_id,callee_id,status,created_at,answered_at,ended_at").single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Impossible de lancer l’appel" }, { status: 500 });
  void sendCallPush({ callerId: auth.profileId, calleeId, callId: data.id }).catch((e) => console.error("Call push failed", e));
  return NextResponse.json({ call: formatCall(data, auth.profileId) });
}
