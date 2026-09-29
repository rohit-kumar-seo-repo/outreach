import type { Queryable } from '../db';
import { one, pool, q } from '../db';
import { digitsOnly, normalizeEmail } from '../normalize';
import { registry, type SourceDef } from '../registry';

export type Channel = 'email' | 'whatsapp';
export type TimeQuality = 'exact' | 'date_only' | 'unknown';

export interface SendAttemptInput {
  idempotencyKey: string;
  channel: Channel;
  campaignSlug: string | null;
  leadId?: number | null;
  sourceKey?: string | null;
  leadRowKey?: string | null;
  leadName?: string | null;
  sender?: string | null;
  recipient: string;
  step: number;
  result: 'accepted' | 'failed' | 'unknown';
  provider?: string | null;
  providerStatus?: string | null;
  errorMessage?: string | null;
  messageId?: string | null;
  subject?: string | null;
  source: 'n8n_execution' | 'n8n_push' | 'sheet_status' | 'mailbox_sent' | 'manual';
  n8n?: { workflowId: string; executionId: string; node: string; runIndex: number; itemIndex: number } | null;
  occurredAt: Date | null;
  timeQuality: TimeQuality;
  waAck?: number | null;
}

export function normalizeRecipient(channel: Channel, recipient: string): string {
  if (channel === 'whatsapp') {
    const digits = digitsOnly(recipient.replace(/@.*$/, ''));
    return digits ? `${digits}@c.us` : recipient.trim().toLowerCase();
  }
  return normalizeEmail(recipient) ?? recipient.trim().toLowerCase();
}

export function normalizeRowKey(src: Pick<SourceDef, 'rowKeyNormalize'>, value: string): string {
  if (src.rowKeyNormalize === 'email') return normalizeEmail(value) ?? value.trim().toLowerCase();
  if (src.rowKeyNormalize === 'phone') return digitsOnly(value) || value.trim();
  return value.trim();
}

const idCache = new Map<string, number>();

export async function campaignId(slug: string | null, client: Queryable = pool()): Promise<number | null> {
  if (!slug) return null;
  const k = `c:${slug}`;
  if (idCache.has(k)) return idCache.get(k)!;
  const row = await one<{ id: number }>('select id from campaigns where slug = $1', [slug], client);
  if (row) idCache.set(k, row.id);
  return row?.id ?? null;
}

export async function mailboxId(address: string | null | undefined, client: Queryable = pool()): Promise<number | null> {
  const a = normalizeEmail(address);
  if (!a || !a.includes('@')) return null;
  const k = `m:${a}`;
  if (idCache.has(k)) return idCache.get(k)!;
  const row = await one<{ id: number }>(
    `insert into mailboxes (address, domain) values ($1, split_part($1,'@',2))
     on conflict (address) do update set address = excluded.address returning id`,
    [a],
    client,
  );
  idCache.set(k, row!.id);
  return row!.id;
}

export function clearIdCache(): void {
  idCache.clear();
}

async function resolveLead(input: SendAttemptInput, cid: number | null, recipientNorm: string, client: Queryable): Promise<number | null> {
  if (input.leadId) return input.leadId;
  if (input.sourceKey && input.leadRowKey) {
    const src = registry().sources.find((s) => s.key === input.sourceKey);
    const key = src ? normalizeRowKey(src, input.leadRowKey) : input.leadRowKey;
    const row = await one<{ id: number }>(
      `select l.id from leads l join sources s on s.id = l.source_id where s.key = $1 and l.source_row_key = $2 limit 1`,
      [input.sourceKey, key],
      client,
    );
    if (row) return row.id;
  }
  if (cid) {
    const col = input.channel === 'whatsapp' ? 'wa_chat_id' : 'email_norm';
    const row = await one<{ id: number }>(
      `select id from leads where campaign_id = $1 and ${col} = $2 order by is_duplicate, source_row_number nulls last limit 1`,
      [cid, recipientNorm],
      client,
    );
    if (row) return row.id;
    const camp = registry().campaigns.find((c) => c.slug === input.campaignSlug);
    if (camp?.leadsFromSends) {
      const srcKey = `sends:${camp.slug}`;
      const src = await one<{ id: number }>(
        `insert into sources (key, kind, name, campaign_id) values ($1,'ingest',$2,$3)
         on conflict (key) do update set name = excluded.name returning id`,
        [srcKey, `Recipients of ${camp.name} (no spreadsheet)`, cid],
        client,
      );
      const created = await one<{ id: number }>(
        `insert into leads (campaign_id, source_id, source_row_key, name, email, email_norm, email_valid, wa_chat_id, sheet_state, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'sent','sent')
         on conflict (source_id, source_row_key) do update set name = coalesce(leads.name, excluded.name)
         returning id`,
        [
          cid,
          src!.id,
          recipientNorm,
          input.leadName ?? null,
          input.channel === 'email' ? recipientNorm : null,
          input.channel === 'email' ? recipientNorm : null,
          input.channel === 'email' ? true : null,
          input.channel === 'whatsapp' ? recipientNorm : null,
        ],
        client,
      );
      return created?.id ?? null;
    }
  }
  return null;
}

/**
 * Insert or refresh one send attempt. Safe to call any number of times with the same
 * idempotency key: a retried sync or a re-delivered webhook updates the same row
 * instead of creating a second attempt, so counts never double.
 */
export async function recordSendAttempt(input: SendAttemptInput, client: Queryable = pool()): Promise<{ id: number; inserted: boolean }> {
  const recipientNorm = normalizeRecipient(input.channel, input.recipient);
  const cid = await campaignId(input.campaignSlug, client);
  const mid = input.channel === 'email' ? await mailboxId(input.sender, client) : null;
  const leadId = await resolveLead(input, cid, recipientNorm, client);
  const row = await one<{ id: number; inserted: boolean }>(
    `insert into send_attempts (
       idempotency_key, channel, campaign_id, lead_id, mailbox_id, sender, recipient, recipient_norm, step, result,
       provider, provider_status, error_message, message_id, subject, source,
       n8n_workflow_id, n8n_execution_id, n8n_node, n8n_run_index, n8n_item_index, occurred_at, time_quality, wa_ack)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     on conflict (idempotency_key) do update set
       campaign_id     = coalesce(send_attempts.campaign_id, excluded.campaign_id),
       lead_id         = coalesce(send_attempts.lead_id, excluded.lead_id),
       mailbox_id      = coalesce(send_attempts.mailbox_id, excluded.mailbox_id),
       result          = case when send_attempts.result = 'unknown' then excluded.result else send_attempts.result end,
       provider_status = coalesce(excluded.provider_status, send_attempts.provider_status),
       error_message   = coalesce(excluded.error_message, send_attempts.error_message),
       message_id      = coalesce(send_attempts.message_id, excluded.message_id),
       subject         = coalesce(send_attempts.subject, excluded.subject),
       occurred_at     = case when send_attempts.time_quality = 'exact' then send_attempts.occurred_at
                              else coalesce(excluded.occurred_at, send_attempts.occurred_at) end,
       time_quality    = case when send_attempts.time_quality = 'exact' then 'exact' else excluded.time_quality end,
       wa_ack          = greatest(send_attempts.wa_ack, excluded.wa_ack),
       updated_at      = now()
     returning id, (xmax = 0) as inserted`,
    [
      input.idempotencyKey,
      input.channel,
      cid,
      leadId,
      mid,
      input.sender?.toLowerCase() ?? null,
      input.recipient,
      recipientNorm,
      input.step,
      input.result,
      input.provider ?? null,
      input.providerStatus?.slice(0, 500) ?? null,
      input.errorMessage?.slice(0, 1000) ?? null,
      input.messageId ?? null,
      input.subject?.slice(0, 500) ?? null,
      input.source,
      input.n8n?.workflowId ?? null,
      input.n8n?.executionId ?? null,
      input.n8n?.node ?? null,
      input.n8n?.runIndex ?? null,
      input.n8n?.itemIndex ?? null,
      input.occurredAt,
      input.timeQuality,
      input.waAck ?? null,
    ],
    client,
  );
  return row!;
}

export async function countAttempts(): Promise<number> {
  const rows = await q<{ n: number }>('select count(*)::int as n from send_attempts');
  return rows[0].n;
}
