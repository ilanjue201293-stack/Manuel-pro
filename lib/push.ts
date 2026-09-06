import "server-only";
import { createECDH, createHash } from "node:crypto";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { PROFILE_NAMES } from "@/lib/profiles";
import type { ProfileId } from "@/types/chat";

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const ONE = BigInt(1);
let cachedKeys: { publicKey: string; privateKey: string } | null = null;
let vapidConfigured = false;

function getSeed() {
  const seed = process.env.CHAT_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) throw new Error("Impossible de dériver les clés Web Push : secret serveur manquant.");
  return seed;
}

function getVapidKeys() {
  if (cachedKeys) return cachedKeys;
  const digest = createHash("sha256").update(`manuel-pro-web-push:${getSeed()}`).digest("hex");
  const scalar = (BigInt(`0x${digest}`) % (P256_ORDER - ONE)) + ONE;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateBytes);
  cachedKeys = {
    privateKey: privateBytes.toString("base64url"),
    publicKey: ecdh.getPublicKey(undefined, "uncompressed").toString("base64url"),
  };
  return cachedKeys;
}

function configureVapid() {
  if (vapidConfigured) return;
  const keys = getVapidKeys();
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const subject = host ? `https://${host}` : "mailto:noreply@example.com";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  vapidConfigured = true;
}

export function getPublicVapidKey() {
  return getVapidKeys().publicKey;
}

async function sendToProfiles(profileIds: string[], payload: Record<string, unknown>, options?: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" }) {
  configureVapid();
  if (!profileIds.length) return;
  const supabase = getSupabaseAdmin();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("endpoint,profile_id,p256dh,auth")
    .in("profile_id", profileIds);
  if (!subscriptions?.length) return;

  await Promise.allSettled(subscriptions.map(async (row: any) => {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }, JSON.stringify(payload), {
        TTL: options?.ttl ?? 60 * 60,
        urgency: options?.urgency ?? "high",
      });
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      } else {
        console.error("Web Push failed:", error);
      }
    }
  }));
}

export async function sendMessagePush({
  conversationId,
  senderId,
  content,
  mediaName,
}: {
  conversationId: string;
  senderId: ProfileId;
  content: string;
  mediaName?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const [{ data: conversation }, { data: members }] = await Promise.all([
    supabase.from("conversations").select("type,title").eq("id", conversationId).maybeSingle(),
    supabase.from("conversation_members").select("profile_id").eq("conversation_id", conversationId).neq("profile_id", senderId),
  ]);

  const recipients = (members || []).map((member: any) => member.profile_id).filter(Boolean);
  if (!recipients.length) return;

  const senderName = PROFILE_NAMES[senderId];
  const title = conversation?.type === "group" && conversation?.title
    ? `${senderName} • ${conversation.title}`
    : senderName;
  const body = content || (mediaName ? `📎 ${mediaName}` : "📎 Nouveau média");
  await sendToProfiles(recipients, {
    kind: "message",
    title,
    body: body.slice(0, 180),
    conversationId,
    url: `/?conversation=${encodeURIComponent(conversationId)}`,
  });
}

export async function sendCallPush({
  callerId,
  calleeId,
  callId,
}: {
  callerId: ProfileId;
  calleeId: ProfileId;
  callId: string;
}) {
  await sendToProfiles([calleeId], {
    kind: "call",
    title: `Appel de ${PROFILE_NAMES[callerId]}`,
    body: "📞 Appel audio entrant",
    callId,
    url: `/?call=${encodeURIComponent(callId)}`,
  }, { ttl: 60, urgency: "high" });
}
