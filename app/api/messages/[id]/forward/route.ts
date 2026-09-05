import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, canAccessMessage, isConversationMember } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const source = await canAccessMessage(id, auth.profileId);
  if (!source || source.deleted_at) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationId || !(await isConversationMember(conversationId, auth.profileId))) {
    return NextResponse.json({ error: "Discussion de destination invalide" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: auth.profileId,
    content: source.content,
    media_path: source.media_path,
    media_name: source.media_name,
    media_type: source.media_type,
    forwarded_from: source.id,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Transfert impossible" }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
