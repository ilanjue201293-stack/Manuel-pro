import "server-only";
import postgres from "postgres";
import type { ProfileId } from "@/types/chat";

export type ActivityKind = "typing" | "recording" | "idle";

function databaseUrl() {
  const value = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Connexion Postgres introuvable");
  return value;
}

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>) {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 12, idle_timeout: 3 });
  try { return await fn(sql); } finally { await sql.end({ timeout: 3 }); }
}

async function ensureTable(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    create table if not exists public.chat_activity (
      profile_id text primary key references public.profiles(id) on delete cascade,
      target_id text not null references public.profiles(id) on delete cascade,
      kind text not null default 'idle' check (kind in ('typing','recording','idle')),
      updated_at timestamptz not null default now()
    );
    create index if not exists chat_activity_target_idx on public.chat_activity(target_id, updated_at desc);
  `);
}

export async function setActivity(profileId: ProfileId, targetId: ProfileId, kind: ActivityKind) {
  return withSql(async (sql) => {
    await ensureTable(sql);
    await sql`
      insert into public.chat_activity(profile_id, target_id, kind, updated_at)
      values (${profileId}, ${targetId}, ${kind}, now())
      on conflict (profile_id) do update
      set target_id = excluded.target_id, kind = excluded.kind, updated_at = now()
    `;
  });
}

export async function getActivityFor(profileId: ProfileId) {
  return withSql(async (sql) => {
    await ensureTable(sql);
    const rows = await sql<{ profile_id: ProfileId; kind: ActivityKind; updated_at: string }[]>`
      select profile_id, kind, updated_at
      from public.chat_activity
      where target_id = ${profileId}
        and kind <> 'idle'
        and updated_at > now() - interval '7 seconds'
      order by updated_at desc
    `;
    return rows;
  });
}
