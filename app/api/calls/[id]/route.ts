import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, isProfileId, PROFILE_NAMES } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  endRoom,
  getMember,
  getRoom,
  getRoomMembers,
  getSignals,
  heartbeat,
  inviteMembers,
  joinRoom,
  leaveRoom,
  type CallRoomRow,
} from "@/lib/call-rooms";
import { sendCallPush } from "@/lib/push";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

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

export async function GET(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  try {
    const room = await getRoom(id, auth.profileId);
    if (!room) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
    const url = new URL(request.url);
    const after = Math.max(0, Number(url.searchParams.get("after") || 0) || 0);
    const signals = await getSignals(id, auth.profileId, after);
    return NextResponse.json({ call: await formatRoom(room, auth.profileId), signals });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Appel indisponible" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  try {
    const room = await getRoom(id, auth.profileId);
    if (!room) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 });
    const member = await getMember(id, auth.profileId);
    if (!member) return NextResponse.json({ error: "Tu ne fais pas partie de cet appel" }, { status: 403 });

    if (action === "accept") {
      if (member.state !== "invited") return NextResponse.json({ error: "Cet appel ne peut plus être accepté" }, { status: 409 });
      await joinRoom(id, auth.profileId, false);
      const updated = await getRoom(id, auth.profileId);
      return NextResponse.json({ call: updated ? await formatRoom(updated, auth.profileId) : null });
    }

    if (action === "resume") {
      if (member.state !== "joined") return NextResponse.json({ error: "Tu n’es plus dans cet appel" }, { status: 409 });
      await joinRoom(id, auth.profileId, true);
      const updated = await getRoom(id, auth.profileId);
      return NextResponse.json({ call: updated ? await formatRoom(updated, auth.profileId) : null });
    }

    if (action === "heartbeat") {
      await heartbeat(id, auth.profileId);
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      await leaveRoom(id, auth.profileId, true);
      return NextResponse.json({ ok: true });
    }

    if (action === "leave") {
      await leaveRoom(id, auth.profileId, false);
      return NextResponse.json({ ok: true });
    }

    if (action === "end") {
      if (room.created_by !== auth.profileId) return NextResponse.json({ error: "Seul le créateur peut terminer l’appel pour tout le monde" }, { status: 403 });
      await endRoom(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "invite") {
      if (member.state !== "joined") return NextResponse.json({ error: "Tu n’es plus dans cet appel" }, { status: 409 });
      const profileIds = Array.isArray(body?.profileIds)
        ? body.profileIds.filter((value: unknown) => isProfileId(value)) as ProfileId[]
        : [];
      if (!profileIds.length) return NextResponse.json({ error: "Choisis au moins une personne" }, { status: 400 });
      const invited = await inviteMembers(id, auth.profileId, profileIds);
      if (invited.length) {
        void sendCallPush({
          callerId: auth.profileId,
          calleeIds: invited,
          callId: id,
          callType: room.call_type,
          groupTitle: "Invitation à rejoindre l’appel",
        }).catch((e) => console.error("Call invite push failed", e));
      }
      const updated = await getRoom(id, auth.profileId);
      return NextResponse.json({ call: updated ? await formatRoom(updated, auth.profileId) : null });
    }

    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action d’appel impossible" }, { status: 500 });
  }
}
