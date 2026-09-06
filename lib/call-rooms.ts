import "server-only";
import postgres from "postgres";
import type { ProfileId } from "@/types/chat";

export type CallType = "audio" | "video";
export type CallMemberState = "invited" | "joined" | "left" | "rejected";

export type CallRoomRow = {
  id: string;
  call_type: CallType;
  status: "active" | "ended";
  created_by: ProfileId;
  conversation_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export type CallMemberRow = {
  call_id: string;
  profile_id: ProfileId;
  state: CallMemberState;
  epoch: number;
  invited_at: string;
  joined_at: string | null;
  last_seen: string | null;
};

export type CallSignalRow = {
  id: string;
  sender_id: ProfileId;
  target_id: ProfileId;
  sender_epoch: number;
  target_epoch: number;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
  created_at: string;
};

function databaseUrl() {
  const value = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Connexion Postgres introuvable");
  return value;
}

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>) {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 12, idle_timeout: 3 });
  try { return await fn(sql); } finally { await sql.end({ timeout: 3 }); }
}

async function ensureTables(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    create table if not exists public.call_rooms (
      id uuid primary key default gen_random_uuid(),
      call_type text not null default 'audio' check (call_type in ('audio','video')),
      status text not null default 'active' check (status in ('active','ended')),
      created_by text not null references public.profiles(id) on delete cascade,
      conversation_id uuid references public.conversations(id) on delete set null,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      ended_at timestamptz
    );
    create table if not exists public.call_room_members (
      call_id uuid not null references public.call_rooms(id) on delete cascade,
      profile_id text not null references public.profiles(id) on delete cascade,
      state text not null default 'invited' check (state in ('invited','joined','left','rejected')),
      epoch integer not null default 0,
      invited_at timestamptz not null default now(),
      joined_at timestamptz,
      last_seen timestamptz,
      primary key (call_id, profile_id)
    );
    create table if not exists public.call_room_signals (
      id bigint generated always as identity primary key,
      call_id uuid not null references public.call_rooms(id) on delete cascade,
      sender_id text not null references public.profiles(id) on delete cascade,
      target_id text not null references public.profiles(id) on delete cascade,
      sender_epoch integer not null,
      target_epoch integer not null,
      kind text not null check (kind in ('offer','answer','ice')),
      payload jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists call_room_members_profile_idx on public.call_room_members(profile_id, state, call_id);
    create index if not exists call_room_members_seen_idx on public.call_room_members(call_id, state, last_seen desc);
    create index if not exists call_room_signals_target_idx on public.call_room_signals(call_id, target_id, id);
  `);
}

async function cleanupStale(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    update public.call_rooms r
    set status = 'ended', ended_at = coalesce(r.ended_at, now())
    where r.status = 'active'
      and r.created_at < now() - interval '3 minutes'
      and not exists (
        select 1 from public.call_room_members m
        where m.call_id = r.id
          and m.state = 'joined'
          and m.last_seen > now() - interval '3 minutes'
      );
  `);
}

export async function createRoom({
  creator,
  callType,
  conversationId,
  calleeId,
}: {
  creator: ProfileId;
  callType: CallType;
  conversationId?: string | null;
  calleeId?: ProfileId | null;
}) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await cleanupStale(sql);

    const existing = await sql<{ id: string }[]>`
      select r.id::text
      from public.call_rooms r
      join public.call_room_members m on m.call_id = r.id
      where r.status = 'active'
        and m.profile_id = ${creator}
        and m.state in ('invited','joined')
      limit 1
    `;
    if (existing.length) throw new Error("Tu es déjà dans un appel");

    let participants: ProfileId[] = [];
    let resolvedConversation: string | null = null;

    if (conversationId) {
      const allowed = await sql<{ profile_id: ProfileId }[]>`
        select profile_id
        from public.conversation_members
        where conversation_id = ${conversationId}::uuid
      `;
      if (!allowed.some((row) => row.profile_id === creator)) throw new Error("Discussion inaccessible");
      participants = allowed.map((row) => row.profile_id).filter((id) => id !== creator);
      resolvedConversation = conversationId;
    } else if (calleeId && calleeId !== creator) {
      participants = [calleeId];
    }

    participants = Array.from(new Set(participants));
    if (!participants.length) throw new Error("Aucun participant à appeler");

    const roomRows = await sql<CallRoomRow[]>`
      insert into public.call_rooms(call_type, status, created_by, conversation_id)
      values (${callType}, 'active', ${creator}, ${resolvedConversation}::uuid)
      returning id::text, call_type, status, created_by, conversation_id::text, created_at, started_at, ended_at
    `;
    const room = roomRows[0];

    await sql`
      insert into public.call_room_members(call_id, profile_id, state, epoch, joined_at, last_seen)
      values (${room.id}::uuid, ${creator}, 'joined', 1, now(), now())
    `;

    for (const profileId of participants) {
      await sql`
        insert into public.call_room_members(call_id, profile_id, state, epoch)
        values (${room.id}::uuid, ${profileId}, 'invited', 0)
        on conflict (call_id, profile_id) do update
        set state = 'invited', invited_at = now()
      `;
    }

    return { room, invited: participants };
  });
}

export async function getActiveRoomFor(profileId: ProfileId) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await cleanupStale(sql);
    const rows = await sql<CallRoomRow[]>`
      select r.id::text, r.call_type, r.status, r.created_by, r.conversation_id::text,
             r.created_at, r.started_at, r.ended_at
      from public.call_rooms r
      join public.call_room_members m on m.call_id = r.id
      where r.status = 'active'
        and m.profile_id = ${profileId}
        and m.state in ('invited','joined')
      order by r.created_at desc
      limit 1
    `;
    return rows[0] || null;
  });
}

export async function getRoom(callId: string, profileId: ProfileId) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await cleanupStale(sql);
    const rows = await sql<CallRoomRow[]>`
      select r.id::text, r.call_type, r.status, r.created_by, r.conversation_id::text,
             r.created_at, r.started_at, r.ended_at
      from public.call_rooms r
      join public.call_room_members mine on mine.call_id = r.id and mine.profile_id = ${profileId}
      where r.id = ${callId}::uuid
      limit 1
    `;
    return rows[0] || null;
  });
}

export async function getRoomMembers(callId: string) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    return sql<CallMemberRow[]>`
      select call_id::text, profile_id, state, epoch, invited_at, joined_at, last_seen
      from public.call_room_members
      where call_id = ${callId}::uuid
      order by invited_at, profile_id
    `;
  });
}

export async function getMember(callId: string, profileId: ProfileId) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    const rows = await sql<CallMemberRow[]>`
      select call_id::text, profile_id, state, epoch, invited_at, joined_at, last_seen
      from public.call_room_members
      where call_id = ${callId}::uuid and profile_id = ${profileId}
      limit 1
    `;
    return rows[0] || null;
  });
}

export async function joinRoom(callId: string, profileId: ProfileId, resume = false) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    const rows = await sql<CallMemberRow[]>`
      update public.call_room_members
      set state = 'joined',
          epoch = epoch + 1,
          joined_at = case when ${resume} then joined_at else coalesce(joined_at, now()) end,
          last_seen = now()
      where call_id = ${callId}::uuid
        and profile_id = ${profileId}
        and state in ('invited','joined')
      returning call_id::text, profile_id, state, epoch, invited_at, joined_at, last_seen
    `;
    if (!rows[0]) throw new Error("Cet appel n’est plus disponible");
    await sql`
      update public.call_rooms
      set started_at = coalesce(started_at, now())
      where id = ${callId}::uuid and status = 'active'
    `;
    return rows[0];
  });
}

export async function heartbeat(callId: string, profileId: ProfileId) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    const rows = await sql<CallMemberRow[]>`
      update public.call_room_members
      set last_seen = now()
      where call_id = ${callId}::uuid
        and profile_id = ${profileId}
        and state = 'joined'
      returning call_id::text, profile_id, state, epoch, invited_at, joined_at, last_seen
    `;
    return rows[0] || null;
  });
}

export async function leaveRoom(callId: string, profileId: ProfileId, rejected = false) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await sql`
      update public.call_room_members
      set state = ${rejected ? "rejected" : "left"}, last_seen = now()
      where call_id = ${callId}::uuid and profile_id = ${profileId}
    `;
    const active = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.call_room_members
      where call_id = ${callId}::uuid and state in ('joined','invited')
    `;
    const joined = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.call_room_members
      where call_id = ${callId}::uuid and state = 'joined'
    `;
    if ((active[0]?.count || 0) === 0 || ((joined[0]?.count || 0) <= 1 && (active[0]?.count || 0) <= 1)) {
      await sql`
        update public.call_rooms
        set status = 'ended', ended_at = coalesce(ended_at, now())
        where id = ${callId}::uuid
      `;
    }
  });
}

export async function endRoom(callId: string) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await sql`
      update public.call_rooms set status = 'ended', ended_at = coalesce(ended_at, now())
      where id = ${callId}::uuid
    `;
  });
}

export async function inviteMembers(callId: string, inviter: ProfileId, profileIds: ProfileId[]) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    const auth = await sql<{ ok: boolean }[]>`
      select exists(
        select 1 from public.call_room_members
        where call_id = ${callId}::uuid and profile_id = ${inviter} and state = 'joined'
      ) as ok
    `;
    if (!auth[0]?.ok) throw new Error("Tu n’es plus dans cet appel");
    const invited: ProfileId[] = [];
    for (const profileId of Array.from(new Set(profileIds)).filter((id) => id !== inviter)) {
      await sql`
        insert into public.call_room_members(call_id, profile_id, state, epoch, invited_at, joined_at, last_seen)
        values (${callId}::uuid, ${profileId}, 'invited', 0, now(), null, null)
        on conflict (call_id, profile_id) do update
        set state = 'invited', invited_at = now(), joined_at = null, last_seen = null
      `;
      invited.push(profileId);
    }
    return invited;
  });
}

export async function getSignals(callId: string, targetId: ProfileId, after: number) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    return sql<CallSignalRow[]>`
      select id::text, sender_id, target_id, sender_epoch, target_epoch, kind, payload, created_at
      from public.call_room_signals
      where call_id = ${callId}::uuid
        and target_id = ${targetId}
        and id > ${after}
      order by id asc
      limit 200
    `;
  });
}

export async function addSignal({
  callId,
  senderId,
  targetId,
  senderEpoch,
  targetEpoch,
  kind,
  payload,
}: {
  callId: string;
  senderId: ProfileId;
  targetId: ProfileId;
  senderEpoch: number;
  targetEpoch: number;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
}) {
  return withSql(async (sql) => {
    await ensureTables(sql);
    await sql`
      insert into public.call_room_signals(call_id, sender_id, target_id, sender_epoch, target_epoch, kind, payload)
      values (${callId}::uuid, ${senderId}, ${targetId}, ${senderEpoch}, ${targetEpoch}, ${kind}, ${sql.json(payload as any)})
    `;
  });
}
