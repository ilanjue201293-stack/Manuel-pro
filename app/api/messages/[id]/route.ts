import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, canAccessMessage } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const message = await canAccessMessage(id, auth.profileId);
  if (!message) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
  if (message.sender_id !== auth.profileId) return NextResponse.json({ error: "Tu ne peux modifier que tes messages" }, { status: 403 });
  if (message.deleted_at) return NextResponse.json({ error: "Message supprimé" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 6000) : "";
  if (!content && !message.media_path) return NextResponse.json({ error: "Message vide" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("messages").update({ content, edited_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const message = await canAccessMessage(id, auth.profileId);
  if (!message) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
  if (message.sender_id !== auth.profileId) return NextResponse.json({ error: "Tu ne peux supprimer que tes messages" }, { status: 403 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("messages").update({
    content: "",
    media_path: null,
    media_name: null,
    media_type: null,
    deleted_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
