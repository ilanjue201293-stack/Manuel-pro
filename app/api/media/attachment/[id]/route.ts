import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getAccessibleAttachment } from "@/lib/message-attachments";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const attachment = await getAccessibleAttachment(id, auth.profileId).catch(() => null);
  if (!attachment || attachment.deleted_at) return new NextResponse(null, { status: 404 });

  const supabase = getSupabaseAdmin();
  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(
    attachment.storage_path,
    300,
    download ? { download: attachment.file_name || true } : undefined,
  );
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 307);
}
