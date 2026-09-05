import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, canAccessMessage } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const ALLOWED = ["👍", "❤️", "😂", "😮", "😢", "🔥", "💀", "✅"];

export async function POST(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  if (!(await canAccessMessage(id, auth.profileId))) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  if (!ALLOWED.includes(emoji)) return NextResponse.json({ error: "Réaction invalide" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("message_reactions")
    .select("message_id")
    .eq("message_id", id)
    .eq("profile_id", auth.profileId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("message_reactions").delete().eq("message_id", id).eq("profile_id", auth.profileId).eq("emoji", emoji);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ active: false });
  }

  const { error } = await supabase.from("message_reactions").insert({ message_id: id, profile_id: auth.profileId, emoji });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ active: true });
}
