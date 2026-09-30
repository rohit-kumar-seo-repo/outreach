// Manual replies from the WhatsApp inbox. This is the only way the dashboard sends WhatsApp
// messages on its own initiative (campaign sends stay entirely in n8n/WAHA) — and only when a
// person presses Send on one conversation:
//  * the sender is whichever of your connected WAHA sessions actually holds this chat, and it
//    must be WORKING right now;
//  * every submit carries an idempotency key, so a double click or a resubmitted form returns
//    the first result instead of sending again, and the same text to the same chat is refused
//    for 10 minutes;
//  * a number that opted out or was marked do-not-contact is refused;
//  * no media, no bulk sending — one message, to one open conversation, in response to a human.
import { createHash } from 'node:crypto';
import { one, q } from '../db';
import { env } from '../env';
import { redact } from '../errors';
import { digitsOnly } from '../normalize';
import { recordWaMessage } from '../sync/wa-store';

export const MAX_BODY = 4096; // WhatsApp's own text message limit

export type ReplyResult = { status: 'sent' | 'failed' | 'unknown' | 'rejected'; message: string; replyId?: number };

interface ChatInfo {
  session: string;
  leadId: number | null;
  campaignId: number | null;
}

async function chatInfo(chatId: string): Promise<ChatInfo | null> {
  const row = await one<{ session: string; lead_id: number | null; campaign_id: number | null }>(
    `select session, lead_id, campaign_id from wa_messages where chat_id = $1 order by sent_at desc limit 1`,
    [chatId],
  );
  return row ? { session: row.session, leadId: row.lead_id, campaignId: row.campaign_id } : null;
}

function describe(row: { id: number; status: string; error_message: string | null }): ReplyResult {
  if (row.status === 'sent') return { status: 'sent', message: 'Sent.', replyId: row.id };
  if (row.status === 'failed') return { status: 'failed', message: `Not sent: ${row.error_message ?? 'WAHA refused it'}.`, replyId: row.id };
  return { status: 'unknown', message: 'WAHA did not confirm this send in time, so it may or may not have gone out. Check the conversation before sending again.', replyId: row.id };
}

export interface WaReplyRequest {
  idempotencyKey: string;
  chatId: string;
  body: string;
}

async function callWaha(path: string, body: unknown): Promise<{ result: 'sent' | 'failed' | 'unknown'; status: string; error?: string; messageId?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${env.wahaBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Api-Key': env.wahaApiKey, accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { result: 'failed', status: `HTTP ${res.status}`, error: text.slice(0, 300) };
    let json: { id?: string; key?: { id?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* WAHA always returns JSON on 2xx; an empty body still counts as accepted */
    }
    const messageId = json.key?.id ?? json.id;
    return messageId ? { result: 'sent', status: '200 OK', messageId } : { result: 'unknown', status: text.slice(0, 300) };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { result: 'unknown', status: timedOut ? 'timeout' : 'error', error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWaReply(req: WaReplyRequest, actor: string): Promise<ReplyResult> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(req.idempotencyKey)) return { status: 'rejected', message: 'This form expired. Reload the conversation and try again.' };
  const prior = await one<{ id: number; status: string; error_message: string | null }>('select id, status, error_message from wa_replies where idempotency_key = $1', [
    req.idempotencyKey,
  ]);
  if (prior) return describe(prior);

  const body = req.body.replace(/\r\n/g, '\n').trim();
  if (!body) return { status: 'rejected', message: 'Write a reply first.' };
  if (body.length > MAX_BODY) return { status: 'rejected', message: `The reply is too long (${body.length.toLocaleString()} characters; WhatsApp's limit is ${MAX_BODY.toLocaleString()}).` };
  if (!env.wahaBaseUrl || !env.wahaApiKey) return { status: 'rejected', message: 'WhatsApp sending is not configured: set WAHA_BASE_URL and WAHA_API_KEY on the server.' };

  const chat = await chatInfo(req.chatId);
  if (!chat) return { status: 'rejected', message: 'This conversation was not found.' };
  const session = await one<{ status: string | null }>('select status from wa_sessions where name = $1', [chat.session]);
  if (session?.status !== 'WORKING') return { status: 'rejected', message: `The WhatsApp account for this chat ("${chat.session}") is not connected right now (status: ${session?.status ?? 'unknown'}).` };

  const digits = digitsOnly(req.chatId.replace(/@.*$/, ''));
  const blocked = await one<{ reason: string }>(
    `select reason from suppressions where channel = 'whatsapp' and value_norm = $1 order by (reason = 'unsubscribed') desc limit 1`,
    [digits],
  );
  if (blocked) return { status: 'rejected', message: `This number is marked ${blocked.reason.replace(/_/g, ' ')}. Remove that before messaging it again.` };

  const bodyHash = createHash('sha256').update(`${req.chatId}\n${body}`).digest('hex');
  const dup = await one<{ mins: number }>(
    `select floor(extract(epoch from (now() - created_at)) / 60)::int as mins from wa_replies
      where chat_id = $1 and body_hash = $2 and status in ('sent', 'sending', 'unknown') and created_at > now() - interval '10 minutes'
      order by created_at desc limit 1`,
    [req.chatId, bodyHash],
  );
  if (dup) return { status: 'rejected', message: `You sent this exact reply to this chat ${dup.mins < 1 ? 'less than a minute' : `${dup.mins} minute(s)`} ago. It was not sent again.` };

  const row = await one<{ id: number }>(
    `insert into wa_replies (idempotency_key, session, chat_id, body_text, body_hash, lead_id, campaign_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (idempotency_key) do nothing returning id`,
    [req.idempotencyKey, chat.session, req.chatId, body, bodyHash, chat.leadId, chat.campaignId, actor],
  );
  if (!row) {
    const other = await one<{ id: number; status: string; error_message: string | null }>('select id, status, error_message from wa_replies where idempotency_key = $1', [req.idempotencyKey]);
    return other ? describe(other) : { status: 'rejected', message: 'This reply is already being sent.' };
  }

  const outcome = await callWaha('/api/sendText', { session: chat.session, chatId: req.chatId, text: body });
  const saved = await one<{ id: number; status: string; error_message: string | null }>(
    `update wa_replies set status = $2, provider_status = $3, error_message = $4, wa_message_id = $5, sent_at = case when $2 = 'sent' then now() end
       where id = $1 returning id, status, error_message`,
    [row.id, outcome.result, outcome.status, outcome.error ? redact(outcome.error).slice(0, 500) : null, outcome.messageId ?? null],
  );
  await q('insert into audit_log (actor, action, target, detail) values ($1,$2,$3,$4)', [
    actor,
    'send_wa_reply',
    req.chatId,
    JSON.stringify({ replyId: row.id, session: chat.session, result: outcome.result, providerStatus: outcome.status, leadId: chat.leadId }),
  ]);
  if (outcome.result !== 'failed' && outcome.messageId) {
    await recordWaMessage({
      session: chat.session,
      messageId: outcome.messageId,
      chatId: req.chatId,
      fromMe: true,
      body,
      hasMedia: false,
      ack: 0,
      sentAt: new Date(),
      source: 'dashboard_reply',
    });
  }
  return describe(saved!);
}
