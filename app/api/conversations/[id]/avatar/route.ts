import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const supabase = getSupabaseAdmin();

  const [{ data: conversation }, { data: membership }] = await Promise.all([
    supabase.from("conversations").select("image_path,type").eq("id", id).maybeSingle(),
    supabase.from("conversation_members").select("profile_id").eq("conversation_id", id).eq("profile_id", auth.profileId).maybeSingle(),
  ]);
  if (!conversation || conversation.type !== "group" || !conversation.image_path || !membership) {
    return new NextResponse(null, { status: 404 });
  }

  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(conversation.image_path, 120);
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 307 });
}
