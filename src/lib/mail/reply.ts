// Replies from the inbox. The only way the dashboard sends email, and only when you press Send:
//  * the sender must be a mailbox connected through the Hostinger Email API that holds a copy of the
//    conversation (the API threads the reply from that copy and saves it to INBOX.Sent);
//  * every submit carries an idempotency key, so a double click or a resubmitted form returns the
//    first result instead of sending again, and the same text to the same thread is refused for 10 minutes;
//  * the send is never retried automatically; a timeout is recorded as "unknown" and confirmed later
//    from the Sent folder;
//  * at most 5 recipients, no attachments, no bulk or scheduled sending.
import { createHash } from 'node:crypto';
import { one, q } from '../db';
import { redact } from '../errors';
import { isValidEmail, normalizeEmail } from '../normalize';
import { discoverHostingerMailboxes, HostingerProvider } from '../sync/mail-hostinger';
import type { MailProvider } from '../sync/mail-types';

export const MAX_RECIPIENTS = 5;
export const MAX_BODY = 20_000;
const SPAM_OR_TRASH = /(^|[./])(spam|junk|trash|deleted)$/i;

export function parseAddressList(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  // "Name <a@x.com>, b@y.com; c@z.com" — a named entry contributes its <address>; bare entries may be space-separated.
  const tokens = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((part) => (/<[^>]+>/.test(part) ? [part.replace(/^.*<([^>]+)>.*$/, '$1')] : part.split(/\s+/)));
  for (const token of tokens) {
    const addr = normalizeEmail(token);
    if (addr && isValidEmail(addr)) {
      if (!valid.includes(addr)) valid.push(addr);
    } else invalid.push(token);
  }
  return { valid, invalid };
}

export function replySubject(subject: string | null): string {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Re: your message';
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

export type ReplyCheck = { ok: true; to: string[]; cc: string[]; body: string } | { ok: false; error: string };

/** Pure input validation (addresses, recipient cap, body size). */
export function checkReplyInput(input: { to: string; cc: string; body: string }): ReplyCheck {
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  const body = input.body.replace(/\r\n/g, '\n').trim();
  if (to.invalid.length || cc.invalid.length) return { ok: false, error: `Not a valid email address: ${[...to.invalid, ...cc.invalid].slice(0, 3).join(', ')}` };
  if (to.valid.length === 0) return { ok: false, error: 'Add at least one recipient.' };
  const ccOnly = cc.valid.filter((a) => !to.valid.includes(a));
  if (to.valid.length + ccOnly.length > MAX_RECIPIENTS) return { ok: false, error: `A reply can go to at most ${MAX_RECIPIENTS} addresses.` };
  if (!body) return { ok: false, error: 'Write a reply first.' };
  if (body.length > MAX_BODY) return { ok: false, error: `The reply is too long (${body.length.toLocaleString()} characters; the limit is ${MAX_BODY.toLocaleString()}).` };
  return { ok: true, to: to.valid, cc: ccOnly, body };
}

export interface SenderOption {
  address: string;
  canSend: boolean;
  /** Why this mailbox cannot send, in plain words. */
  reason: string | null;
  /** The message in this mailbox the reply is threaded from. */
  source: { id: number; folder: string; uid: number } | null;
}

export interface ReplyContext {
  options: SenderOption[];
  defaultFrom: string | null;
  defaultTo: string[];
  subject: string;
  leadId: number | null;
  campaignId: number | null;
  /** Recipients that must not be emailed (hard bounce) or asked not to be (unsubscribe). */
  blocked: { address: string; reason: string }[];
  /** No reply makes sense (only bounce reports in the thread). */
  replyable: boolean;
}

interface ThreadMsg {
  id: number;
  mailbox_id: number;
  address: string;
  provider: string;
  last_status: string | null;
  last_error: string | null;
  folder: string;
  uid: number;
  direction: string;
  kind: string;
  from_addr: string | null;
  to_addrs: string[];
  subject: string | null;
  sent_at: Date | null;
  lead_id: number | null;
  campaign_id: number | null;
}

function cannotSendReason(m: Pick<ThreadMsg, 'provider' | 'last_status' | 'last_error'>): string | null {
  if (m.provider === 'imap') return 'Connected over IMAP, which is read-only here. Sending needs a Hostinger Email API token that covers this mailbox.';
  if (m.provider !== 'hostinger_api' || m.last_status === 'not_connected') return 'Not connected: no Hostinger Email API token covers this mailbox.';
  if (m.last_status !== 'ok') return `Its last sync failed (${(m.last_error ?? 'unknown error').slice(0, 140)}), so sending from it is paused until it syncs again.`;
  return null;
}

export async function replyContext(threadKey: string): Promise<ReplyContext> {
  const msgs = await q<ThreadMsg>(
    `select m.id, m.mailbox_id, mb.address, mb.provider, mb.last_status, mb.last_error, m.folder, m.uid, m.direction, m.kind, m.from_addr,
            m.to_addrs, m.subject, m.sent_at, m.lead_id, m.campaign_id
       from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
      where m.thread_key = $1 and not m.gone_from_server
      order by m.sent_at desc nulls last, m.id desc`,
    [threadKey],
  );
  const own = new Set((await q<{ address: string }>('select address from mailboxes')).map((r) => r.address));
  const answerable = msgs.filter((m) => m.kind !== 'bounce' && !SPAM_OR_TRASH.test(m.folder));
  const latestIn = answerable.find((m) => m.direction === 'inbound');
  const latest = latestIn ?? answerable[0];

  // Every mailbox holding the conversation, the receiving one first.
  const byMailbox = new Map<string, SenderOption>();
  const ordered = latestIn ? [latestIn, ...answerable.filter((m) => m !== latestIn)] : answerable;
  for (const m of ordered) {
    if (byMailbox.has(m.address)) continue;
    const src = answerable.find((x) => x.address === m.address && x.direction === 'inbound') ?? answerable.find((x) => x.address === m.address);
    const reason = cannotSendReason(m);
    byMailbox.set(m.address, { address: m.address, canSend: !reason && !!src, reason, source: src ? { id: src.id, folder: src.folder, uid: src.uid } : null });
  }
  // Connected mailboxes without a copy are listed, disabled, so it is clear why they cannot be used.
  const others = await q<{ address: string }>(`select address from mailboxes where provider = 'hostinger_api' and last_status = 'ok' order by address`);
  for (const o of others) {
    if (!byMailbox.has(o.address))
      byMailbox.set(o.address, { address: o.address, canSend: false, reason: 'Has no copy of this conversation, so a reply from it could not stay in the thread.', source: null });
  }

  let defaultTo: string[] = [];
  if (latest?.direction === 'inbound' && latest.from_addr) defaultTo = [latest.from_addr];
  else if (latest) defaultTo = latest.to_addrs.filter((a) => !own.has(a));
  const blocked = defaultTo.length
    ? await q<{ address: string; reason: string }>(
        `select value_norm as address, case when reason = 'hard_bounce' then 'hard bounce: the address does not exist' else 'asked not to be contacted (' || reason || ')' end as reason
           from suppressions where channel = 'email' and value_norm = any($1)`,
        [defaultTo],
      )
    : [];
  const withLead = msgs.find((m) => m.lead_id);
  return {
    options: [...byMailbox.values()],
    defaultFrom: latest?.address ?? null,
    defaultTo,
    subject: replySubject(latest?.subject ?? msgs[0]?.subject ?? null),
    leadId: withLead?.lead_id ?? null,
    campaignId: withLead?.campaign_id ?? msgs.find((m) => m.campaign_id)?.campaign_id ?? null,
    blocked,
    replyable: answerable.length > 0,
  };
}

export interface ReplyRequest {
  idempotencyKey: string;
  threadKey: string;
  from: string;
  to: string;
  cc: string;
  body: string;
}

export type ReplyResult = { status: 'sent' | 'failed' | 'unknown' | 'rejected'; message: string; replyId?: number };

export type ProviderResolver = (address: string) => Promise<MailProvider | null>;

async function hostingerResolver(address: string): Promise<MailProvider | null> {
  const { found } = await discoverHostingerMailboxes();
  const ref = found.find((m) => m.address === address);
  return ref ? new HostingerProvider(address, ref) : null;
}

function describe(row: { id: number; status: string; error_message: string | null }): ReplyResult {
  if (row.status === 'sent') return { status: 'sent', message: 'Reply sent. It is in the Sent folder and stays in this conversation.', replyId: row.id };
  if (row.status === 'failed') return { status: 'failed', message: `Not sent: ${row.error_message ?? 'the mail server refused it'}. Nothing was delivered; you can try again.`, replyId: row.id };
  return {
    status: 'unknown',
    message:
      'The mail server did not confirm this reply, so it may or may not have gone out. Check the Sent folder before sending again; the dashboard confirms it automatically once a copy appears there.',
    replyId: row.id,
  };
}

export async function sendReply(req: ReplyRequest, actor: string, resolve: ProviderResolver = hostingerResolver): Promise<ReplyResult> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(req.idempotencyKey)) return { status: 'rejected', message: 'This form expired. Reload the conversation and try again.' };
  const prior = await one<{ id: number; status: string; error_message: string | null }>('select id, status, error_message from mail_replies where idempotency_key = $1', [
    req.idempotencyKey,
  ]);
  if (prior) return describe(prior);

  const input = checkReplyInput(req);
  if (!input.ok) return { status: 'rejected', message: input.error };
  const ctx = await replyContext(req.threadKey);
  if (!ctx.replyable) return { status: 'rejected', message: 'This conversation has nothing that can be answered (for example, only bounce reports).' };
  const from = normalizeEmail(req.from) ?? '';
  const option = ctx.options.find((o) => o.address === from);
  if (!option) return { status: 'rejected', message: `${from || 'That address'} is not one of your connected mailboxes.` };
  if (!option.canSend || !option.source) return { status: 'rejected', message: `Cannot send from ${from}: ${option.reason ?? 'no copy of this conversation in that mailbox.'}` };

  const hard = await q<{ value_norm: string }>(`select value_norm from suppressions where channel = 'email' and reason = 'hard_bounce' and value_norm = any($1)`, [
    [...input.to, ...input.cc],
  ]);
  if (hard.length) return { status: 'rejected', message: `${hard.map((h) => h.value_norm).join(', ')} bounced permanently (the address does not exist). Remove it and try again.` };

  const bodyHash = createHash('sha256').update(`${req.threadKey}\n${input.body}`).digest('hex');
  const dup = await one<{ mins: number }>(
    `select floor(extract(epoch from (now() - created_at)) / 60)::int as mins from mail_replies
      where thread_key = $1 and body_hash = $2 and status in ('sent', 'sending', 'unknown') and created_at > now() - interval '10 minutes'
      order by created_at desc limit 1`,
    [req.threadKey, bodyHash],
  );
  if (dup) return { status: 'rejected', message: `You sent this exact reply to this conversation ${dup.mins < 1 ? 'less than a minute' : `${dup.mins} minute(s)`} ago. It was not sent again.` };

  const provider = await resolve(from);
  if (!provider?.sendReply) return { status: 'rejected', message: `Cannot send from ${from}: the Hostinger Email API token for it is missing or no longer valid.` };
  const displayName =
    (
      await one<{ from_name: string | null }>(
        `select from_name from mail_messages where mailbox_id = (select id from mailboxes where address = $1) and direction = 'outbound'
            and from_name is not null and from_name <> '' and kind <> 'internal' order by sent_at desc nulls last limit 1`,
        [from],
      )
    )?.from_name ?? null;

  const row = await one<{ id: number }>(
    `insert into mail_replies (idempotency_key, thread_key, source_message_id, mailbox_id, from_addr, to_addrs, cc_addrs, subject, body_text, body_hash,
        lead_id, campaign_id, provider, created_by)
     values ($1, $2, $3, (select id from mailboxes where address = $4), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (idempotency_key) do nothing returning id`,
    [req.idempotencyKey, req.threadKey, option.source.id, from, input.to, input.cc, ctx.subject, input.body, bodyHash, ctx.leadId, ctx.campaignId, provider.kind, actor],
  );
  if (!row) {
    const other = await one<{ id: number; status: string; error_message: string | null }>('select id, status, error_message from mail_replies where idempotency_key = $1', [
      req.idempotencyKey,
    ]);
    return other ? describe(other) : { status: 'rejected', message: 'This reply is already being sent.' };
  }

  let outcome;
  try {
    outcome = await provider.sendReply({
      to: input.to,
      cc: input.cc,
      subject: ctx.subject,
      text: input.body,
      displayName,
      inReplyTo: { folder: option.source.folder, uid: option.source.uid },
    });
  } catch (err) {
    outcome = { result: 'unknown' as const, status: 'Error', error: (err as Error).message };
  } finally {
    await provider.close();
  }
  const saved = await one<{ id: number; status: string; error_message: string | null }>(
    `update mail_replies set status = $2, provider_status = $3, error_message = $4, sent_at = case when $2 = 'sent' then now() end
      where id = $1 returning id, status, error_message`,
    [row.id, outcome.result, outcome.status, outcome.error ? redact(outcome.error).slice(0, 500) : null],
  );
  await q('insert into audit_log (actor, action, target, detail) values ($1, $2, $3, $4)', [
    actor,
    'send_reply',
    req.threadKey,
    JSON.stringify({ replyId: row.id, from, to: input.to, cc: input.cc, result: outcome.result, providerStatus: outcome.status, leadId: ctx.leadId }),
  ]);
  if (outcome.result !== 'failed') {
    // Answered: read in the dashboard, back from snooze, and a mailbox sync picks up the Sent copy.
    await q(`update mail_messages set read_override = true where thread_key = $1 and direction = 'inbound'`, [req.threadKey]);
    await q(`update inbox_threads set snoozed_until = null, snoozed_at = null, updated_at = now(), updated_by = $2 where thread_key = $1`, [req.threadKey, actor]);
    await q(
      `insert into app_state (key, value) values ('sync_request', '{"jobs":["mailboxes"]}')
       on conflict (key) do update set value = jsonb_build_object('jobs', (select jsonb_agg(distinct j) from jsonb_array_elements_text(coalesce(app_state.value->'jobs', '[]'::jsonb) || '["mailboxes"]'::jsonb) j)), updated_at = now()`,
    );
  }
  return describe(saved!);
}
