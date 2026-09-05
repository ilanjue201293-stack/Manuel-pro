import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { ProfileId } from "@/types/chat";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ensureInitialized } from "@/lib/bootstrap";

export async function requireApiSession(): Promise<{ profileId: ProfileId } | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }
  try {
    await ensureInitialized();
  } catch (error) {
    console.error("Automatic database setup failed:", error);
    return NextResponse.json(
      { error: "La base Supabase n'est pas encore correctement connectée à Vercel." },
      { status: 503 },
    );
  }
  return { profileId: session.profileId };
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export async function isConversationMember(conversationId: string, profileId: ProfileId): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function canAccessMessage(messageId: string, profileId: ProfileId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, media_path, media_name, media_type, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const member = await isConversationMember(data.conversation_id, profileId);
  return member ? data : null;
}
