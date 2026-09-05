"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ProfileId } from "@/types/chat";

export default function Avatar({
  src,
  profileId,
  name,
  size = 42,
  online,
}: {
  src?: string | null;
  profileId: ProfileId;
  name: string;
  size?: number;
  online?: boolean;
}) {
  const fallback = `/avatars/${profileId}.svg`;
  const [current, setCurrent] = useState(src || fallback);

  useEffect(() => setCurrent(src || fallback), [src, fallback]);

  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
      <Image
        className="avatar-image"
        src={current}
        alt={name}
        width={size}
        height={size}
        unoptimized
        onError={() => setCurrent(fallback)}
      />
      {typeof online === "boolean" && <span className={`presence-dot ${online ? "online" : "offline"}`} />}
    </span>
  );
}
