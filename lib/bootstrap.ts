import "server-only";
import postgres from "postgres";
import { getSupabaseAdmin, MEDIA_BUCKET } from "@/lib/supabase-admin";

let bootstrapPromise: Promise<void> | null = null;

function databaseUrl(): string {
  const value = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Base Supabase non connectée à Vercel : POSTGRES_URL_NON_POOLING / POSTGRES_URL introuvable.");
  return value;
}

async function createSchema() {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 });
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(814733921)`;
      await tx.unsafe(`
        create table if not exists public.profiles (id text primary key, display_name text not null, avatar_path text, created_at timestamptz not null default now());
        create table if not exists public.profile_settings (profile_id text primary key references public.profiles(id) on delete cascade, accent text not null default '#6d5efc', font_scale numeric(4,2) not null default 1.00 check (font_scale between 0.85 and 1.30), theme text not null default 'dark' check (theme in ('dark','light')), updated_at timestamptz not null default now());
        create table if not exists public.conversations (id uuid primary key default gen_random_uuid(), type text not null check (type in ('dm','group')), title text, image_path text, created_by text references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
        create table if not exists public.conversation_members (conversation_id uuid not null references public.conversations(id) on delete cascade, profile_id text not null references public.profiles(id) on delete cascade, joined_at timestamptz not null default now(), primary key (conversation_id, profile_id));
        create table if not exists public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade, sender_id text not null references public.profiles(id) on delete cascade, content text not null default '', media_path text, media_name text, media_type text, reply_to uuid references public.messages(id) on delete set null, forwarded_from uuid references public.messages(id) on delete set null, created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz, constraint message_has_content check (deleted_at is not null or length(trim(content)) > 0 or media_path is not null));
        create table if not exists public.message_reactions (message_id uuid not null references public.messages(id) on delete cascade, profile_id text not null references public.profiles(id) on delete cascade, emoji text not null check (char_length(emoji) between 1 and 12), created_at timestamptz not null default now(), primary key (message_id, profile_id, emoji));
        create table if not exists public.message_reads (message_id uuid not null references public.messages(id) on delete cascade, profile_id text not null references public.profiles(id) on delete cascade, read_at timestamptz not null default now(), primary key (message_id, profile_id));
        create table if not exists public.presence (profile_id text primary key references public.profiles(id) on delete cascade, last_seen timestamptz not null default now());
        create table if not exists public.push_subscriptions (endpoint text primary key, profile_id text not null references public.profiles(id) on delete cascade, p256dh text not null, auth text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
        create table if not exists public.call_sessions (
          id uuid primary key default gen_random_uuid(),
          caller_id text not null references public.profiles(id) on delete cascade,
          callee_id text not null references public.profiles(id) on delete cascade,
          status text not null default 'ringing' check (status in ('ringing','accepted','rejected','ended')),
          created_at timestamptz not null default now(),
          answered_at timestamptz,
          ended_at timestamptz,
          check (caller_id <> callee_id)
        );
        create table if not exists public.call_signals (
          id bigint generated always as identity primary key,
          call_id uuid not null references public.call_sessions(id) on delete cascade,
          sender_id text not null references public.profiles(id) on delete cascade,
          kind text not null check (kind in ('offer','answer','ice')),
          payload jsonb not null,
          created_at timestamptz not null default now()
        );
        create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
        create index if not exists conversation_members_profile_idx on public.conversation_members(profile_id, conversation_id);
        create index if not exists message_reads_message_idx on public.message_reads(message_id);
        create index if not exists presence_last_seen_idx on public.presence(last_seen desc);
        create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);
        create index if not exists call_sessions_caller_status_idx on public.call_sessions(caller_id, status, created_at desc);
        create index if not exists call_sessions_callee_status_idx on public.call_sessions(callee_id, status, created_at desc);
        create index if not exists call_signals_call_id_idx on public.call_signals(call_id, id);
        create or replace function public.bump_conversation_on_message() returns trigger language plpgsql security definer set search_path = public as $$ begin update public.conversations set updated_at = now() where id = new.conversation_id; return new; end; $$;
        drop trigger if exists trg_bump_conversation_on_message on public.messages;
        create trigger trg_bump_conversation_on_message after insert or update on public.messages for each row execute function public.bump_conversation_on_message();
        alter table public.profiles enable row level security; alter table public.profile_settings enable row level security; alter table public.conversations enable row level security; alter table public.conversation_members enable row level security; alter table public.messages enable row level security; alter table public.message_reactions enable row level security; alter table public.message_reads enable row level security; alter table public.presence enable row level security; alter table public.push_subscriptions enable row level security; alter table public.call_sessions enable row level security; alter table public.call_signals enable row level security;
        revoke all on table public.profiles from anon, authenticated; revoke all on table public.profile_settings from anon, authenticated; revoke all on table public.conversations from anon, authenticated; revoke all on table public.conversation_members from anon, authenticated; revoke all on table public.messages from anon, authenticated; revoke all on table public.message_reactions from anon, authenticated; revoke all on table public.message_reads from anon, authenticated; revoke all on table public.presence from anon, authenticated; revoke all on table public.push_subscriptions from anon, authenticated; revoke all on table public.call_sessions from anon, authenticated; revoke all on table public.call_signals from anon, authenticated;
        grant all on table public.profiles to service_role; grant all on table public.profile_settings to service_role; grant all on table public.conversations to service_role; grant all on table public.conversation_members to service_role; grant all on table public.messages to service_role; grant all on table public.message_reactions to service_role; grant all on table public.message_reads to service_role; grant all on table public.presence to service_role; grant all on table public.push_subscriptions to service_role; grant all on table public.call_sessions to service_role; grant all on table public.call_signals to service_role;
        grant usage, select on sequence public.call_signals_id_seq to service_role;
        notify pgrst, 'reload schema';
      `);
      await tx`insert into public.profiles(id, display_name) values ('ilan','Ilan'),('naim','Naïm'),('juul','Juul'),('ruben','Ruben') on conflict (id) do update set display_name = excluded.display_name`;
      await tx`insert into public.profile_settings(profile_id) select id from public.profiles on conflict (profile_id) do nothing`;
      await tx`insert into public.presence(profile_id, last_seen) select id, now() - interval '1 day' from public.profiles on conflict (profile_id) do nothing`;
      const dmSeeds = [["00000000-0000-4000-8000-000000000001","ilan","naim"],["00000000-0000-4000-8000-000000000002","ilan","juul"],["00000000-0000-4000-8000-000000000003","ilan","ruben"],["00000000-0000-4000-8000-000000000004","naim","juul"],["00000000-0000-4000-8000-000000000005","naim","ruben"],["00000000-0000-4000-8000-000000000006","juul","ruben"]] as const;
      for (const [id,a,b] of dmSeeds) {
        await tx`insert into public.conversations(id, type, created_by) values (${id}::uuid, 'dm', ${a}) on conflict (id) do nothing`;
        await tx`insert into public.conversation_members(conversation_id, profile_id) values (${id}::uuid, ${a}), (${id}::uuid, ${b}) on conflict (conversation_id, profile_id) do nothing`;
      }
    });
  } finally { await sql.end({ timeout: 5 }); }
}

async function ensureStorage() {
  const supabase = getSupabaseAdmin();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = (buckets || []).some((bucket) => bucket.id === MEDIA_BUCKET || bucket.name === MEDIA_BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(MEDIA_BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 });
    if (createError && !/already exists|duplicate/i.test(createError.message)) throw createError;
  } else {
    try { await supabase.storage.updateBucket(MEDIA_BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 }); } catch {}
  }
}

async function waitForDataApi() {
  const supabase = getSupabaseAdmin();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (!error) return;
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error("Supabase Data API schema cache did not refresh");
}

export async function ensureInitialized(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => { await createSchema(); await ensureStorage(); await waitForDataApi(); })().catch((error) => { bootstrapPromise = null; throw error; });
  }
  return bootstrapPromise;
}
