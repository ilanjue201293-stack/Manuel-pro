import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { ProfileId } from "@/types/chat";
import { getProfilePassword, isProfileId } from "@/lib/profiles";

const COOKIE_NAME = "friends_chat_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  profileId: ProfileId;
  exp: number;
  passwordVersion: string;
};

function secret(): string {
  const value =
    process.env.CHAT_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!value || value.length < 24) {
    throw new Error("Secret de session indisponible : connecte Supabase à Vercel ou ajoute CHAT_SESSION_SECRET.");
  }
  return value;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function passwordVersion(profileId: ProfileId): string {
  const password = getProfilePassword(profileId);
  if (!password) throw new Error(`Password ENV missing for ${profileId}`);
  return createHmac("sha256", secret()).update(`${profileId}:${password}`).digest("base64url");
}

export function createSessionToken(profileId: ProfileId): string {
  const payload: SessionPayload = {
    profileId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    passwordVersion: passwordVersion(profileId),
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!isProfileId(payload.profileId)) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.passwordVersion || !safeEqual(payload.passwordVersion, passwordVersion(payload.profileId))) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function setSession(profileId: ProfileId): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(profileId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function comparePassword(input: string, expected: string): boolean {
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
