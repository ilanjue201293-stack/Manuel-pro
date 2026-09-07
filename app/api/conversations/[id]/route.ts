import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { isProfileId } from "@/lib/profiles";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function getManagedGroup(id: string, profileId: string) {
  const supabase = getSupabaseAdmin();
  const [{ data: conversation }, { data: membership }] = await Promise.all([
    supabase.from("conversations").select("id,type,title,image_path,created_by").eq("id", id).maybeSingle(),
    supabase.from("conversation_members").select("profile_id").eq("conversation_id", id).eq("profile_id", profileId).maybeSingle(),
  ]);
  if (!conversation || conversation.type !== "group" || !membership) return null;
  return conversation;
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const conversation = await getManagedGroup(id, auth.profileId);
  if (!conversation) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  if (typeof body.removeMember === "string") {
    const memberId = body.removeMember;
    if (!isProfileId(memberId) || memberId === auth.profileId) {
      return NextResponse.json({ error: "Membre invalide" }, { status: 400 });
    }
    const { data: members, error: membersError } = await supabase
      .from("conversation_members")
      .select("profile_id")
      .eq("conversation_id", id);
    if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
    if ((members || []).length <= 2) {
      return NextResponse.json({ error: "Un groupe doit garder au moins 2 membres" }, { status: 409 });
    }
    if (!(members || []).some((member: any) => member.profile_id === memberId)) {
      return NextResponse.json({ error: "Cette personne n’est plus dans le groupe" }, { status: 409 });
    }
    const { error } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", id)
      .eq("profile_id", memberId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 50);
    if (!title) return NextResponse.json({ error: "Le nom du groupe ne peut pas être vide" }, { status: 400 });
    update.title = title;
  }
  if (typeof body.imagePath === "string") {
    if (!body.imagePath.startsWith("group-images/")) {
      return NextResponse.json({ error: "Photo de groupe invalide" }, { status: 400 });
    }
    update.image_path = body.imagePath;
  }
  if (body.removeImage === true) update.image_path = null;

  if (Object.keys(update).length === 1) return NextResponse.json({ ok: true });
  const { error } = await supabase.from("conversations").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const conversation = await getManagedGroup(id, auth.profileId);
  if (!conversation) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 });

  const supabase = getSupabaseAdmin();
  if (conversation.image_path) {
    await supabase.storage.from(MEDIA_BUCKET).remove([conversation.image_path]).catch(() => undefined);
  }
  const { error } = await supabase.from("conversations").delete().eq("id", id).eq("type", "group");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
