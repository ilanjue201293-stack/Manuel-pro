import "server-only";
import postgres from "postgres";

function databaseUrl() {
  const value = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Connexion Postgres introuvable");
  return value;
}

let upgradePromise: Promise<void> | null = null;

export async function ensureCallTypeColumn() {
  if (upgradePromise) return upgradePromise;
  upgradePromise = (async () => {
    const sql = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 12, idle_timeout: 3 });
    try {
      await sql.unsafe(`
        alter table public.call_sessions add column if not exists call_type text not null default 'audio';
        do $$ begin
          if not exists (
            select 1 from pg_constraint where conname = 'call_sessions_call_type_check'
          ) then
            alter table public.call_sessions add constraint call_sessions_call_type_check check (call_type in ('audio','video'));
          end if;
        end $$;
        notify pgrst, 'reload schema';
      `);
    } finally {
      await sql.end({ timeout: 3 });
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  })().catch((error) => {
    upgradePromise = null;
    throw error;
  });
  return upgradePromise;
}
