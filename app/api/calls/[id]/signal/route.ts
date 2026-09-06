import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const supabase = getSupabaseAdmin();
  const { data: call } = await supabase
    .from("call_sessions")
    .select("id,caller_id,callee_id,status")
    .eq("id", id)
    .maybeSingle();

  if (!call || (call.caller_id !== auth.profileId && call.callee_id !== auth.profileId)) {
    return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
  }
  if (["ended", "rejected"].includes(call.status)) {
    return NextResponse.json({ error: "Appel terminé" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind;
  const payload = body?.payload;
  if (!["offer", "answer", "ice"].includes(kind) || !payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Signal invalide" }, { status: 400 });
  }

  const { error } = await supabase.from("call_signals").insert({
    call_id: id,
    sender_id: auth.profileId,
    kind,
    payload,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
