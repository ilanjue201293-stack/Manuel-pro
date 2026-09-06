import { NextResponse } from "next/server";
import { requireApiSession, isErrorResponse } from "@/lib/api";
import { getPublicVapidKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (isErrorResponse(auth)) return auth;
  return NextResponse.json({ publicKey: getPublicVapidKey() });
}
