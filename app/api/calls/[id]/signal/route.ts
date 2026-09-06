import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { addSignal, getMember, getRoom } from "@/lib/call-rooms";
import { isProfileId } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;

  try {
    const room = await getRoom(id, auth.profileId);
    if (!room || room.status !== "active") return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
    const mine = await getMember(id, auth.profileId);
    if (!mine || mine.state !== "joined") return NextResponse.json({ error: "Tu n’es plus dans cet appel" }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const kind = body?.kind;
    const payload = body?.payload;
    const targetId = body?.targetId;
    const senderEpoch = Number(body?.senderEpoch);
    const targetEpoch = Number(body?.targetEpoch);

    if (!["offer", "answer", "ice"].includes(kind) || !payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Signal invalide" }, { status: 400 });
    }
    if (!isProfileId(targetId) || targetId === auth.profileId) {
      return NextResponse.json({ error: "Destinataire invalide" }, { status: 400 });
    }
    if (!Number.isInteger(senderEpoch) || !Number.isInteger(targetEpoch) || senderEpoch < 1 || targetEpoch < 1) {
      return NextResponse.json({ error: "Session d’appel invalide" }, { status: 400 });
    }

    const target = await getMember(id, targetId);
    if (!target || target.state !== "joined") return NextResponse.json({ error: "Participant indisponible" }, { status: 409 });
    if (Number(mine.epoch) !== senderEpoch || Number(target.epoch) !== targetEpoch) {
      return NextResponse.json({ error: "Connexion remplacée" }, { status: 409 });
    }

    await addSignal({
      callId: id,
      senderId: auth.profileId,
      targetId,
      senderEpoch,
      targetEpoch,
      kind,
      payload,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Signal impossible" }, { status: 500 });
  }
}
