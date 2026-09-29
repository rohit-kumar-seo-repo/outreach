'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { assertSameOrigin, requireSession } from '@/lib/auth/session';
import { one, q } from '@/lib/db';
import { env } from '@/lib/env';
import { bodyPolicy, loadBody } from '@/lib/mail/body';
import { sendReply, type ReplyResult } from '@/lib/mail/reply';
import { deriveLeads } from '@/lib/sync/derive';
import { providerFor } from '@/lib/sync/mail-sync';
import { addDays, localDate } from '@/lib/time';

async function guard(): Promise<string> {
  await assertSameOrigin();
  return (await requireSession()).email;
}

async function audit(actor: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  await q('insert into audit_log (actor, action, target, detail) values ($1,$2,$3,$4)', [actor, action, target, JSON.stringify(detail)]);
}

function threadOf(form: FormData): string {
  const t = String(form.get('thread') ?? '');
  if (!t || t.length > 1000) throw new Error('Missing conversation.');
  return t;
}

export interface ReplyState extends Partial<ReplyResult> {
  /** Fresh key for the next submit; the one just used can never send again. */
  nextKey: string;
}

export async function sendReplyAction(_prev: ReplyState, form: FormData): Promise<ReplyState> {
  const actor = await guard();
  const res = await sendReply(
    {
      idempotencyKey: String(form.get('key') ?? ''),
      threadKey: String(form.get('thread') ?? ''),
      from: String(form.get('from') ?? ''),
      to: String(form.get('to') ?? ''),
      cc: String(form.get('cc') ?? ''),
      body: String(form.get('body') ?? ''),
    },
    actor,
  );
  if (res.status === 'sent' || res.status === 'unknown') await deriveLeads();
  revalidatePath('/inbox');
  // Keep the key after a rejection (nothing was recorded) so an immediate double submit still dedupes;
  // rotate it once a reply row exists.
  return { ...res, nextKey: res.replyId ? randomUUID() : String(form.get('key') ?? randomUUID()) };
}

/** Local wall-clock time in the dashboard timezone → timestamptz, computed by Postgres. */
async function localToInstant(localDateTime: string): Promise<Date> {
  const row = await one<{ at: Date }>(`select ($1::timestamp at time zone $2) as at`, [localDateTime, env.timezone]);
  return row!.at;
}

export async function snoozeThread(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = threadOf(form);
  const preset = String(form.get('preset') ?? '');
  const today = localDate();
  let local: string | null = null;
  if (preset === 'later') {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: env.timezone }).format(new Date()));
    local = hour < 17 ? `${today}T18:00` : `${addDays(today, 1)}T09:00`;
  } else if (preset === 'tomorrow') local = `${addDays(today, 1)}T09:00`;
  else if (preset === 'monday') {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    local = `${addDays(today, ((8 - dow) % 7) || 7)}T09:00`;
  } else if (preset === 'week') local = `${addDays(today, 7)}T09:00`;
  else {
    const custom = String(form.get('until') ?? '');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(custom)) local = custom;
  }
  if (!local) return;
  const until = await localToInstant(local);
  if (until.getTime() <= Date.now()) return;
  await q(
    `insert into inbox_threads (thread_key, snoozed_until, snoozed_at, updated_by) values ($1, $2, now(), $3)
     on conflict (thread_key) do update set snoozed_until = excluded.snoozed_until, snoozed_at = now(), updated_at = now(), updated_by = excluded.updated_by`,
    [thread, until, actor],
  );
  await audit(actor, 'snooze_thread', thread, { until: until.toISOString() });
  revalidatePath('/inbox');
}

export async function unsnoozeThread(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = threadOf(form);
  await q(`update inbox_threads set snoozed_until = null, snoozed_at = null, updated_at = now(), updated_by = $2 where thread_key = $1`, [thread, actor]);
  await audit(actor, 'unsnooze_thread', thread);
  revalidatePath('/inbox');
}

/** "No reply needed": leaves Needs reply until they write again. */
export async function markHandled(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = threadOf(form);
  const undo = form.get('undo') === '1';
  await q(
    `insert into inbox_threads (thread_key, handled_at, updated_by) values ($1, case when $2 then null else now() end, $3)
     on conflict (thread_key) do update set handled_at = excluded.handled_at, updated_at = now(), updated_by = excluded.updated_by`,
    [thread, undo, actor],
  );
  await audit(actor, undo ? 'reopen_thread' : 'mark_handled', thread);
  revalidatePath('/inbox');
}

/** Read state lives in the dashboard only; the mailbox's own read flags are never changed. */
export async function setThreadRead(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = threadOf(form);
  const read = form.get('read') === '1';
  if (read) {
    await q(`update mail_messages set read_override = true where thread_key = $1 and direction = 'inbound'`, [thread]);
  } else {
    // Unread = the latest message they sent is unread again.
    await q(
      `update mail_messages set read_override = false
        where id = (select id from mail_messages where thread_key = $1 and direction = 'inbound' order by sent_at desc nulls last limit 1)`,
      [thread],
    );
  }
  await audit(actor, read ? 'mark_read' : 'mark_unread', thread);
  revalidatePath('/inbox');
}

/** Called when a conversation is opened (not on prefetch): marks it read in the dashboard. */
export async function markOpened(thread: string): Promise<void> {
  await guard();
  if (!thread || thread.length > 1000) return;
  const n = await q(
    `update mail_messages set read_override = true
      where thread_key = $1 and direction = 'inbound' and coalesce(not read_override, unseen) returning id`,
    [thread],
  );
  if (n.length) revalidatePath('/inbox');
}

/** Loads one message body on request (used when automatic loading is paused for unread mail). */
export async function loadMessageBody(form: FormData): Promise<void> {
  await guard();
  const id = Number(form.get('messageId'));
  const row = await one<{ address: string; folder: string; uid: number; unseen: boolean }>(
    `select mb.address, m.folder, m.uid, m.unseen from mail_messages m join mailboxes mb on mb.id = m.mailbox_id where m.id = $1`,
    [id],
  );
  if (!row) return;
  const provider = await providerFor(row.address);
  if (!provider) throw new Error('This mailbox is not connected, so the message cannot be loaded.');
  try {
    await loadBody(provider, { id, folder: row.folder, uid: row.uid, unseen: row.unseen });
  } finally {
    await provider.close();
  }
  revalidatePath('/inbox');
}

/** Loads the bodies an open conversation still misses (read messages always; unread ones unless paused). */
export async function ensureBodies(thread: string): Promise<number> {
  await guard();
  const policy = await bodyPolicy();
  const rows = await q<{ id: number; address: string; folder: string; uid: number; unseen: boolean }>(
    `select m.id, mb.address, m.folder, m.uid, m.unseen from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
      where m.thread_key = $1 and m.body_fetched_at is null and mb.last_status = 'ok' and ($2::boolean = false or not m.unseen)
      order by m.sent_at desc nulls last limit 12`,
    [thread, policy.askBeforeUnread],
  );
  let loaded = 0;
  for (const address of [...new Set(rows.map((r) => r.address))]) {
    const provider = await providerFor(address);
    if (!provider) continue;
    try {
      for (const r of rows.filter((x) => x.address === address)) {
        if (!(await loadBody(provider, r))) break;
        loaded++;
      }
    } catch {
      /* shown as "not loaded" in the thread; the next sync retries */
    } finally {
      await provider.close();
    }
  }
  if (loaded) revalidatePath('/inbox');
  return loaded;
}
