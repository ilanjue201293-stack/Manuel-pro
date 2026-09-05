import type { ProfileId } from "@/types/chat";

export const PROFILE_IDS: ProfileId[] = ["ilan", "naim", "juul", "ruben"];

export const PROFILE_NAMES: Record<ProfileId, string> = {
  ilan: "Ilan",
  naim: "Naïm",
  juul: "Juul",
  ruben: "Ruben",
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && PROFILE_IDS.includes(value as ProfileId);
}

export function getProfilePassword(profileId: ProfileId): string | undefined {
  const map: Record<ProfileId, string | undefined> = {
    ilan: process.env.ILAN_PASSWORD,
    naim: process.env.NAIM_PASSWORD,
    juul: process.env.JUUL_PASSWORD,
    ruben: process.env.RUBEN_PASSWORD,
  };
  return map[profileId];
}

export function fallbackAvatar(profileId: ProfileId): string {
  return `/avatars/${profileId}.svg`;
}
