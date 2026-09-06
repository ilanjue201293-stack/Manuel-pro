import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse, isConversationMember } from "@/lib/api";
import { fallbackAvatar, PROFILE_NAMES, isProfileId } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendMessagePush } from "@/lib/push";
import { addMessageAttachments, getMessageAttachments } from "@/lib/message-attachments";
import type { ProfileId } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type IncomingMedia = { path: string; name: string; type: string };

function cleanMedia(body: any, profileId: string): IncomingMedia[] {
  const raw: unknown[] = Array.isArray(body?.media)
    ? body.media
    : body?.mediaPath
      ? [{ path: body.mediaPath, name: body.mediaName, type: body.mediaType }]
      : [];

  const result: IncomingMedia[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path : "";
    if (!path.startsWith(`messages/${profileId}/`)) continue;
    result.push({
      path,
      name: typeof row.name === "string" ? row.name.slice(0, 200) : "Fichier",
      type: typeof row.type === "string" ? row.type.slice(0, 120) : "application/octet-stream",
    });
  }
  return result;
}

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
  const unread = messages
    .filter((m: any) => m.sender_id !== auth.profileId)
    .map((m: any) => ({ message_id: m.id, profile_id: auth.profileId }));
  if (unread.length) {
    await supabase.from("message_reads").upsert(unread, { onConflict: "message_id,profile_id", ignoreDuplicates: true });
  }

  const replyIds = Array.from(new Set(messages.map((m: any) => m.reply_to).filter(Boolean)));
  const [{ data: reactions }, { data: reads }, { data: profiles }, replyResult, attachments] = await Promise.all([
    ids.length ? supabase.from("message_reactions").select("message_id, profile_id, emoji").in("message_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("message_reads").select("message_id, profile_id").in("message_id", ids) : Promise.resolve({ data: [] as any[] }),
    supabase.from("profiles").select("id, display_name, avatar_path"),
    replyIds.length ? supabase.from("messages").select("id, sender_id, content, deleted_at").in("id", replyIds) : Promise.resolve({ data: [] as any[] }),
    getMessageAttachments(ids).catch(() => []),
  ]);

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const replyMap = new Map(((replyResult as any).data || []).map((m: any) => [m.id, m]));
  const attachmentMap = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const current = attachmentMap.get(attachment.message_id) || [];
    current.push(attachment);
    attachmentMap.set(attachment.message_id, current);
  }

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
    const stored = attachmentMap.get(m.id) || [];
    const renderedAttachments = m.deleted_at ? [] : stored.map((a) => ({
      id: a.id,
      url: `/api/media/attachment/${a.id}`,
      name: a.file_name,
      type: a.mime_type,
    }));

    if (!m.deleted_at && !renderedAttachments.length && m.media_path) {
      renderedAttachments.push({
        id: `legacy-${m.id}`,
        url: `/api/media/message/${m.id}`,
        name: m.media_name || "Fichier",
        type: m.media_type || "application/octet-stream",
      });
    }

    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: sender,
      senderName: p?.display_name || PROFILE_NAMES[sender],
      senderAvatarUrl: p?.avatar_path ? `/api/avatar/${sender}?v=${encodeURIComponent(p.avatar_path)}` : fallbackAvatar(sender),
      content: m.deleted_at ? "" : m.content,
      mediaUrl: renderedAttachments[0]?.url || null,
      mediaName: renderedAttachments[0]?.name || null,
      mediaType: renderedAttachments[0]?.type || null,
      attachments: renderedAttachments,
      replyTo: reply ? {
        id: reply.id,
        senderId: replySender || sender,
        senderName: replySender ? PROFILE_NAMES[replySender] : "Message",
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
  const media = cleanMedia(body, auth.profileId);
  const replyTo = typeof body.replyTo === "string" ? body.replyTo : null;

  if (!content && !media.length) return NextResponse.json({ error: "Message vide" }, { status: 400 });
  if ((Array.isArray(body?.media) ? body.media.length : media.length) > 10) {
    return NextResponse.json({ error: "Maximum 10 médias par message" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (replyTo) {
    const { data: reply } = await supabase.from("messages").select("conversation_id").eq("id", replyTo).maybeSingle();
    if (!reply || reply.conversation_id !== conversationId) {
      return NextResponse.json({ error: "Réponse invalide" }, { status: 400 });
    }
  }

  const first = media[0] || null;
  const { data, error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: auth.profileId,
    content,
    media_path: first?.path || null,
    media_name: first?.name || null,
    media_type: first?.type || null,
    reply_to: replyTo,
  }).select("id").single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Envoi impossible" }, { status: 500 });

  try {
    await addMessageAttachments(data.id, media);
  } catch (attachmentError) {
    console.error("Message attachments error:", attachmentError);
  }

  await supabase.from("message_reads").upsert(
    { message_id: data.id, profile_id: auth.profileId },
    { onConflict: "message_id,profile_id" },
  );

  const pushMedia = media.length > 1 ? `${media.length} médias` : media[0]?.name || null;
  await sendMessagePush({ conversationId, senderId: auth.profileId, content, mediaName: pushMedia }).catch((pushError) => {
    console.error("Push notification error:", pushError);
  });
  return NextResponse.json({ id: data.id });
}
