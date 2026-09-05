import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ACCENTS = ["#6d5efc", "#2f80ed", "#16a085", "#e056fd", "#e67e22", "#e74c3c"];

export async function PATCH(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  if (typeof body.avatarPath === "string") {
    if (!body.avatarPath.startsWith(`avatars/${auth.profileId}/`)) {
      return NextResponse.json({ error: "Avatar invalide" }, { status: 400 });
    }
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_path: body.avatarPath })
      .eq("id", auth.profileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.accent === "string" && ACCENTS.includes(body.accent)) update.accent = body.accent;
  if (body.theme === "dark" || body.theme === "light") update.theme = body.theme;
  if (typeof body.fontScale === "number" && body.fontScale >= 0.85 && body.fontScale <= 1.3) {
    update.font_scale = body.fontScale;
  }

  if (Object.keys(update).length > 1) {
    const { error } = await supabase
      .from("profile_settings")
      .upsert({ profile_id: auth.profileId, ...update }, { onConflict: "profile_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
