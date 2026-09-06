import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, isProfileId, PROFILE_NAMES } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createRoom, getActiveRoomFor, getRoomMembers, type CallRoomRow } from "@/lib/call-rooms";
import { sendCallPush } from "@/lib/push";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function formatRoom(room: CallRoomRow, me: ProfileId) {
  const members = await getRoomMembers(room.id);
  const supabase = getSupabaseAdmin();
  const { data: profiles } = await supabase.from("profiles").select("id,display_name,avatar_path");
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const threshold = Date.now() - 8_000;
  const formattedMembers = members.map((member) => {
    const profile: any = profileMap.get(member.profile_id);
    return {
      id: member.profile_id,
      displayName: profile?.display_name || PROFILE_NAMES[member.profile_id],
      avatarUrl: profile?.avatar_path
        ? `/api/avatar/${member.profile_id}?v=${encodeURIComponent(profile.avatar_path)}`
        : fallbackAvatar(member.profile_id),
      state: member.state,
      epoch: Number(member.epoch) || 0,
      online: member.state === "joined" && Boolean(member.last_seen) && new Date(member.last_seen as string).getTime() > threshold,
      lastSeen: member.last_seen,
      isCreator: member.profile_id === room.created_by,
    };
  });
  const mine = formattedMembers.find((member) => member.id === me);
  return {
    id: room.id,
    callType: room.call_type,
    status: room.status,
    createdBy: room.created_by,
    conversationId: room.conversation_id,
    createdAt: room.created_at,
    startedAt: room.started_at,
    endedAt: room.ended_at,
    meState: mine?.state || "left",
    meEpoch: mine?.epoch || 0,
    members: formattedMembers,
  };
}

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  try {
    const room = await getActiveRoomFor(auth.profileId);
    if (!room) return NextResponse.json({ call: null });
    return NextResponse.json({ call: await formatRoom(room, auth.profileId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Appel indisponible" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const body = await request.json().catch(() => ({}));
  const callType = body?.callType === "video" ? "video" : "audio";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  const calleeId = isProfileId(body?.calleeId) ? body.calleeId : null;

  if (!conversationId && (!calleeId || calleeId === auth.profileId)) {
    return NextResponse.json({ error: "Destinataire invalide" }, { status: 400 });
  }

  try {
    const { room, invited } = await createRoom({
      creator: auth.profileId,
      callType,
      conversationId,
      calleeId,
    });
    const title = conversationId ? "Appel de groupe" : undefined;
    void sendCallPush({
      callerId: auth.profileId,
      calleeIds: invited,
      callId: room.id,
      callType,
      groupTitle: title,
    }).catch((e) => console.error("Call push failed", e));
    return NextResponse.json({ call: await formatRoom(room, auth.profileId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer l’appel";
    const status = /déjà|inaccessible|participant/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
