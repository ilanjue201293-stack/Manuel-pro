import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function safeName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned.slice(-100) || "file";
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const fileName = typeof body.fileName === "string" ? body.fileName : "file";
  const contentType = typeof body.contentType === "string" ? body.contentType : "application/octet-stream";
  const size = Number(body.size || 0);
  const kind = body.kind === "avatar" ? "avatar" : "message";

  const max = kind === "avatar" ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
  if (!Number.isFinite(size) || size <= 0 || size > max) {
    return NextResponse.json({ error: `Fichier trop gros (max ${kind === "avatar" ? "10" : "100"} Mo)` }, { status: 400 });
  }

  if (kind === "avatar" && !contentType.startsWith("image/")) {
    return NextResponse.json({ error: "L'avatar doit être une image" }, { status: 400 });
  }

  const folder = kind === "avatar" ? "avatars" : "messages";
  const path = `${folder}/${auth.profileId}/${randomUUID()}-${safeName(fileName)}`;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Upload impossible" }, { status: 500 });
  }

  return NextResponse.json({ path, token: data.token });
}
