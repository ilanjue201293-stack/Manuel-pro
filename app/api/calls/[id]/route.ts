import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ensureCallTypeColumn } from "@/lib/call-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function getCall(id: string, profileId: string) {
  await ensureCallTypeColumn();
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("call_sessions")
    .select("id,caller_id,callee_id,status,call_type,created_at,answered_at,ended_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || (data.caller_id !== profileId && data.callee_id !== profileId)) return null;
  return data;
}

export async function GET(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const call = await getCall(id, auth.profileId);
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });

  const url = new URL(request.url);
  const after = Math.max(0, Number(url.searchParams.get("after") || 0) || 0);
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("call_signals")
    .select("id,sender_id,kind,payload,created_at")
    .eq("call_id", id)
    .neq("sender_id", auth.profileId)
    .order("id", { ascending: true })
    .limit(100);
  if (after > 0) query = query.gt("id", after);
  const { data: signals, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    call: {
      id: call.id,
      callerId: call.caller_id,
      calleeId: call.callee_id,
      status: call.status,
      callType: call.call_type === "video" ? "video" : "audio",
      createdAt: call.created_at,
      answeredAt: call.answered_at,
      endedAt: call.ended_at,
    },
    signals: signals || [],
  });
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const call = await getCall(id, auth.profileId);
  if (!call) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  const supabase = getSupabaseAdmin();

  if (action === "accept") {
    if (auth.profileId !== call.callee_id || call.status !== "ringing") {
      return NextResponse.json({ error: "Cet appel ne peut plus être accepté" }, { status: 409 });
    }
    const { error } = await supabase.from("call_sessions").update({
      status: "accepted",
      answered_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "ringing");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    if (auth.profileId !== call.callee_id || call.status !== "ringing") {
      return NextResponse.json({ error: "Cet appel ne peut plus être refusé" }, { status: 409 });
    }
    await supabase.from("call_sessions").update({ status: "rejected", ended_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  if (action === "end") {
    if (["ended", "rejected"].includes(call.status)) return NextResponse.json({ ok: true });
    await supabase.from("call_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 400 });
}
