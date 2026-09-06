import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, isConversationMember } from "@/lib/api";
import { fallbackAvatar, PROFILE_NAMES, isProfileId } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendMessagePush } from "@/lib/push";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id: conversationId } = await context.params;
  if (!(await isConversationMember(conversationId, auth.profileId))) {
    return NextResponse.json({ error: "Discussion inaccessible" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data: descMessages, error: messageError } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, media_path, media_name, media_type, reply_to, forwarded_from, created_at, edited_at, deleted_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(150);

  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });
  const messages = [...(descMessages || [])].reverse();
  const ids = messages.map((m: any) => m.id);
  const unread = messages.filter((m: any) => m.sender_id !== auth.profileId).map((m: any) => ({ message_id: m.id, profile_id: auth.profileId }));
  if (unread.length) {
    await supabase.from("message_reads").upsert(unread, { onConflict: "message_id,profile_id", ignoreDuplicates: true });
  }

  const replyIds = Array.from(new Set(messages.map((m: any) => m.reply_to).filter(Boolean)));
  const [{ data: reactions }, { data: reads }, { data: profiles }, replyResult] = await Promise.all([
    ids.length ? supabase.from("message_reactions").select("message_id, profile_id, emoji").in("message_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("message_reads").select("message_id, profile_id").in("message_id", ids) : Promise.resolve({ data: [] as any[] }),
    supabase.from("profiles").select("id, display_name, avatar_path"),
    replyIds.length ? supabase.from("messages").select("id, sender_id, content, deleted_at").in("id", replyIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const replyMap = new Map(((replyResult as any).data || []).map((m: any) => [m.id, m]));

  const formatted = messages.map((m: any) => {
    const sender = isProfileId(m.sender_id) ? m.sender_id as ProfileId : "ilan" as ProfileId;
    const p: any = profileMap.get(sender);
    const reactionMap = new Map<string, ProfileId[]>();
    (reactions || []).filter((r: any) => r.message_id === m.id).forEach((r: any) => {
      if (!isProfileId(r.profile_id)) return;
      const list = reactionMap.get(r.emoji) || [];
      list.push(r.profile_id);
      reactionMap.set(r.emoji, list);
    });
    const reply: any = m.reply_to ? replyMap.get(m.reply_to) : null;
    const replySender = reply && isProfileId(reply.sender_id) ? reply.sender_id as ProfileId : null;

    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: sender,
      senderName: p?.display_name || PROFILE_NAMES[sender],
      senderAvatarUrl: p?.avatar_path ? `/api/avatar/${sender}?v=${encodeURIComponent(p.avatar_path)}` : fallbackAvatar(sender),
      content: m.deleted_at ? "" : m.content,
      mediaUrl: m.deleted_at || !m.media_path ? null : `/api/media/message/${m.id}`,
      mediaName: m.deleted_at ? null : m.media_name,
      mediaType: m.deleted_at ? null : m.media_type,
      replyTo: reply ? {
        id: reply.id,
        senderId: replySender || sender,
        senderName: replySender ? (PROFILE_NAMES[replySender]) : "Message",
        content: reply.deleted_at ? "Message supprimé" : reply.content,
        deleted: Boolean(reply.deleted_at),
      } : null,
      forwarded: Boolean(m.forwarded_from),
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      reactions: Array.from(reactionMap.entries()).map(([emoji, profileIds]) => ({ emoji, profileIds })),
      readBy: (reads || []).filter((r: any) => r.message_id === m.id && isProfileId(r.profile_id)).map((r: any) => r.profile_id as ProfileId),
    };
  });

  return NextResponse.json({ messages: formatted });
}

export async function POST(request: Request, context: Context) {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  const { id: conversationId } = await context.params;
  if (!(await isConversationMember(conversationId, auth.profileId))) {
    return NextResponse.json({ error: "Discussion inaccessible" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 6000) : "";
  const mediaPath = typeof body.mediaPath === "string" ? body.mediaPath : null;
  const mediaName = typeof body.mediaName === "string" ? body.mediaName.slice(0, 200) : null;
  const mediaType = typeof body.mediaType === "string" ? body.mediaType.slice(0, 120) : null;
  const replyTo = typeof body.replyTo === "string" ? body.replyTo : null;

  if (!content && !mediaPath) return NextResponse.json({ error: "Message vide" }, { status: 400 });
  if (mediaPath && !mediaPath.startsWith(`messages/${auth.profileId}/`)) {
    return NextResponse.json({ error: "Média invalide" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (replyTo) {
    const { data: reply } = await supabase.from("messages").select("conversation_id").eq("id", replyTo).maybeSingle();
    if (!reply || reply.conversation_id !== conversationId) {
      return NextResponse.json({ error: "Réponse invalide" }, { status: 400 });
    }
  }

  const { data, error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: auth.profileId,
    content,
    media_path: mediaPath,
    media_name: mediaName,
    media_type: mediaType,
    reply_to: replyTo,
  }).select("id").single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Envoi impossible" }, { status: 500 });
  await supabase.from("message_reads").upsert({ message_id: data.id, profile_id: auth.profileId }, { onConflict: "message_id,profile_id" });
  await sendMessagePush({ conversationId, senderId: auth.profileId, content, mediaName }).catch((pushError) => {
    console.error("Push notification error:", pushError);
  });
  return NextResponse.json({ id: data.id });
}
