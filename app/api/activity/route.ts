import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getActivityFor, setActivity, type ActivityKind } from "@/lib/activity";
import { isProfileId, PROFILE_NAMES } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  try {
    const rows = await getActivityFor(auth.profileId);
    return NextResponse.json({
      activities: rows.map((row) => ({
        profileId: row.profile_id,
        displayName: PROFILE_NAMES[row.profile_id],
        kind: row.kind,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Activité indisponible" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const body = await request.json().catch(() => ({}));
  const targetId = body?.targetId;
  const kind = body?.kind as ActivityKind;
  if (!isProfileId(targetId) || targetId === auth.profileId) {
    return NextResponse.json({ error: "Destinataire invalide" }, { status: 400 });
  }
  if (!["typing", "recording", "idle"].includes(kind)) {
    return NextResponse.json({ error: "Activité invalide" }, { status: 400 });
  }
  try {
    await setActivity(auth.profileId, targetId, kind);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Activité indisponible" }, { status: 500 });
  }
}
