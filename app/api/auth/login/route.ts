import { NextResponse } from "next/server";
import { comparePassword, setSession } from "@/lib/auth";
import { getProfilePassword, isProfileId } from "@/lib/profiles";
import { ensureInitialized } from "@/lib/bootstrap";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const profileId = body?.profileId;
    const password = body?.password;

    if (!isProfileId(profileId) || typeof password !== "string") {
      return NextResponse.json({ error: "Profil ou mot de passe invalide" }, { status: 400 });
    }

    const expected = getProfilePassword(profileId);
    if (!expected) {
      return NextResponse.json({ error: "Mot de passe non configuré dans Vercel" }, { status: 500 });
    }

    if (!comparePassword(password, expected)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
    }

    try {
      await ensureInitialized();
    } catch (error) {
      console.error("Automatic database setup failed:", error);
      const detail = error instanceof Error ? error.message : "Erreur Supabase inconnue";
      return NextResponse.json(
        { error: `Initialisation Supabase impossible : ${detail}` },
        { status: 503 },
      );
    }

    await setSession(profileId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Impossible de se connecter" }, { status: 500 });
  }
}
