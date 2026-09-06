import "server-only";
import postgres from "postgres";

export type StoredAttachment = {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  sort_order: number;
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

async function ensureTable(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    create table if not exists public.message_attachments (
      id uuid primary key default gen_random_uuid(),
      message_id uuid not null references public.messages(id) on delete cascade,
      storage_path text not null,
      file_name text not null,
      mime_type text not null default 'application/octet-stream',
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );
    create index if not exists message_attachments_message_idx
      on public.message_attachments(message_id, sort_order, created_at);
  `);
}

export async function addMessageAttachments(
  messageId: string,
  attachments: { path: string; name: string; type: string }[],
) {
  if (!attachments.length) return;
  await withSql(async (sql) => {
    await ensureTable(sql);
    for (let index = 0; index < attachments.length; index += 1) {
      const item = attachments[index];
      await sql`
        insert into public.message_attachments(message_id, storage_path, file_name, mime_type, sort_order)
        values (${messageId}::uuid, ${item.path}, ${item.name}, ${item.type}, ${index})
      `;
    }
  });
}

export async function getMessageAttachments(messageIds: string[]) {
  if (!messageIds.length) return [] as StoredAttachment[];
  return withSql(async (sql) => {
    await ensureTable(sql);
    return sql<StoredAttachment[]>`
      select id::text, message_id::text, storage_path, file_name, mime_type, sort_order
      from public.message_attachments
      where message_id = any(${messageIds}::uuid[])
      order by message_id, sort_order, created_at
    `;
  });
}

export async function getAccessibleAttachment(attachmentId: string, profileId: string) {
  return withSql(async (sql) => {
    await ensureTable(sql);
    const rows = await sql<{
      storage_path: string;
      file_name: string;
      mime_type: string;
      deleted_at: string | null;
    }[]>`
      select a.storage_path, a.file_name, a.mime_type, m.deleted_at
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where a.id = ${attachmentId}::uuid
        and cm.profile_id = ${profileId}
      limit 1
    `;
    return rows[0] || null;
  });
}
