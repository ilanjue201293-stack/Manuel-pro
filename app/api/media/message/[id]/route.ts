import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, canAccessMessage } from "@/lib/api";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const message = await canAccessMessage(id, auth.profileId);
  if (!message?.media_path || message.deleted_at) return new NextResponse(null, { status: 404 });

  const supabase = getSupabaseAdmin();
  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(message.media_path, 300, download ? { download: message.media_name || true } : undefined);
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 307);
}
