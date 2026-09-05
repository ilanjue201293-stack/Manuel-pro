import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { fallbackAvatar, PROFILE_NAMES, isProfileId } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const supabase = getSupabaseAdmin();

  const { data: myMemberships, error: membershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("profile_id", auth.profileId);

  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  const ids = (myMemberships || []).map((m: any) => m.conversation_id);
  if (!ids.length) return NextResponse.json({ conversations: [] });

  const [{ data: conversations, error: cError }, { data: members, error: mError }, { data: messages, error: msgError }, { data: profiles, error: pError }, { data: presence, error: prError }] = await Promise.all([
    supabase.from("conversations").select("id, type, title, image_path, updated_at").in("id", ids).order("updated_at", { ascending: false }),
    supabase.from("conversation_members").select("conversation_id, profile_id").in("conversation_id", ids),
    supabase.from("messages").select("id, conversation_id, sender_id, content, media_name, created_at, deleted_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(500),
    supabase.from("profiles").select("id, display_name, avatar_path"),
    supabase.from("presence").select("profile_id, last_seen"),
  ]);

  if (cError || mError || msgError || pError || prError) {
    return NextResponse.json({ error: "Impossible de charger les discussions" }, { status: 500 });
  }

  const allMessages = messages || [];
  const messageIds = allMessages.map((m: any) => m.id);
  const { data: reads } = messageIds.length
    ? await supabase.from("message_reads").select("message_id").eq("profile_id", auth.profileId).in("message_id", messageIds)
    : { data: [] as any[] };
  const readSet = new Set((reads || []).map((r: any) => r.message_id));

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const threshold = Date.now() - 45_000;
  const onlineMap = new Map((presence || []).map((p: any) => [p.profile_id, new Date(p.last_seen).getTime() > threshold]));

  const response = (conversations || []).map((conversation: any) => {
    const memberIds = (members || []).filter((m: any) => m.conversation_id === conversation.id).map((m: any) => m.profile_id as ProfileId);
    const publicMembers = memberIds.filter(isProfileId).map((id: ProfileId) => {
      const p: any = profileMap.get(id);
      return {
        id,
        displayName: p?.display_name || PROFILE_NAMES[id],
        avatarUrl: p?.avatar_path ? `/api/avatar/${id}?v=${encodeURIComponent(p.avatar_path)}` : fallbackAvatar(id),
        online: id === auth.profileId || Boolean(onlineMap.get(id)),
      };
    });

    const conversationMessages = allMessages.filter((m: any) => m.conversation_id === conversation.id);
    const last = conversationMessages[0] || null;
    const unreadCount = conversationMessages.filter((m: any) => m.sender_id !== auth.profileId && !m.deleted_at && !readSet.has(m.id)).length;
    const other = publicMembers.find((m: { id: ProfileId; displayName: string; avatarUrl: string; online: boolean }) => m.id !== auth.profileId);

    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.type === "dm" ? (other?.displayName || "Discussion") : (conversation.title || "Groupe"),
      avatarUrl: conversation.type === "dm" ? (other?.avatarUrl || null) : null,
      members: publicMembers,
      lastMessage: last ? {
        content: last.deleted_at ? "Message supprimé" : (last.content || (last.media_name ? `📎 ${last.media_name}` : "Média")),
        senderId: last.sender_id,
        createdAt: last.created_at,
      } : null,
      updatedAt: conversation.updated_at,
      unreadCount,
    };
  });

  return NextResponse.json({ conversations: response });
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 50) : "";
  const requested = Array.isArray(body.members) ? body.members.filter(isProfileId) as ProfileId[] : [];
  const memberIds = Array.from(new Set<ProfileId>([auth.profileId, ...requested]));

  if (!title) return NextResponse.json({ error: "Donne un nom au groupe" }, { status: 400 });
  if (memberIds.length < 2) return NextResponse.json({ error: "Choisis au moins une autre personne" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: conversation, error: cError } = await supabase
    .from("conversations")
    .insert({ type: "group", title, created_by: auth.profileId })
    .select("id")
    .single();

  if (cError || !conversation) return NextResponse.json({ error: cError?.message || "Création impossible" }, { status: 500 });

  const { error: mError } = await supabase.from("conversation_members").insert(
    memberIds.map((profileId) => ({ conversation_id: conversation.id, profile_id: profileId })),
  );

  if (mError) {
    await supabase.from("conversations").delete().eq("id", conversation.id);
    return NextResponse.json({ error: mError.message }, { status: 500 });
  }

  return NextResponse.json({ id: conversation.id });
}
