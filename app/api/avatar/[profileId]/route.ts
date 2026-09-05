import { NextResponse } from "next/server";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";
import { isProfileId } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ profileId: string }> };

export async function GET(_request: Request, context: Context) {
  const { profileId } = await context.params;
  if (!isProfileId(profileId)) return new NextResponse(null, { status: 404 });

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile?.avatar_path) return new NextResponse(null, { status: 404 });
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(profile.avatar_path, 300);
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(data.signedUrl, 307);
}
