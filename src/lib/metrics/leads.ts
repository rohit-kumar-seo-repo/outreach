import { env } from '../env';
import { one, q } from '../db';
import { Params } from './filters';

export interface LeadRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  waChatId: string | null;
  campaignSlug: string;
  campaignName: string;
  channel: string;
  sourceName: string | null;
  sourceUrl: string | null;
  rowNumber: number | null;
  status: string;
  sheetStatus: string | null;
  sendsAccepted: number;
  followupsAccepted: number;
  lastContactedAt: Date | null;
  lastReplyAt: Date | null;
  replySentiment: string | null;
  nextFollowupAt: Date | null;
}

export interface LeadQuery {
  campaign?: string | null;
  status?: string | null;
  source?: string | null;
  search?: string | null;
  followup?: 'due' | 'today' | 'overdue' | null;
  page?: number;
  pageSize?: number;
}

export async function listLeads(opts: LeadQuery): Promise<{ rows: LeadRow[]; total: number }> {
  const p = new Params();
  const where: string[] = ['l.present_in_source or l.sends_accepted > 0'];
  if (opts.campaign) where.push(`c.slug = ${p.add(opts.campaign)}`);
  if (opts.status) where.push(`l.status = ${p.add(opts.status)}`);
  if (opts.source) where.push(`s.key = ${p.add(opts.source)}`);
  if (opts.search) {
    const s = p.add(`%${opts.search.toLowerCase()}%`);
    where.push(`(lower(coalesce(l.name,'')) like ${s} or coalesce(l.email_norm,'') like ${s} or coalesce(l.phone_norm,'') like ${s} or lower(l.source_row_key) like ${s})`);
  }
  if (opts.followup) {
    const tz = p.add(env.timezone);
    const today = `(now() at time zone ${tz})::date`;
    const due = `(l.next_followup_at at time zone ${tz})::date`;
    where.push(`l.next_followup_at is not null and l.status in ('followup_due','sent','queued')`);
    if (opts.followup === 'today') where.push(`${due} = ${today}`);
    else if (opts.followup === 'overdue') where.push(`${due} < ${today}`);
    else where.push(`${due} <= ${today}`);
  }
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const offset = Math.max(0, ((opts.page ?? 1) - 1) * pageSize);
  const base = `from leads l join campaigns c on c.id = l.campaign_id left join sources s on s.id = l.source_id where ${where.map((w) => `(${w})`).join(' and ')}`;
  const total = (await one<{ n: number }>(`select count(*)::int as n ${base}`, p.values))?.n ?? 0;
  const order = opts.followup ? 'l.next_followup_at asc' : 'coalesce(l.last_reply_at, l.last_contacted_at, l.updated_at) desc nulls last, l.id desc';
  const rows = await q<LeadRow>(
    `select l.id, l.name, l.email_norm as email, l.phone, l.wa_chat_id as "waChatId", c.slug as "campaignSlug", c.name as "campaignName",
            c.channel, s.name as "sourceName", s.external_url as "sourceUrl", l.source_row_number as "rowNumber", l.status,
            l.sheet_status as "sheetStatus", l.sends_accepted as "sendsAccepted", l.followups_accepted as "followupsAccepted",
            l.last_contacted_at as "lastContactedAt", l.last_reply_at as "lastReplyAt", l.reply_sentiment as "replySentiment",
            l.next_followup_at as "nextFollowupAt"
       ${base} order by ${order} limit ${pageSize} offset ${offset}`,
    p.values,
  );
  return { rows, total };
}

export async function leadDetail(id: number) {
  const lead = await one<
    LeadRow & {
      website: string | null;
      city: string | null;
      country: string | null;
      category: string | null;
      raw: Record<string, unknown>;
      isDuplicate: boolean;
      duplicateOf: number | null;
      suppressed: boolean;
      suppressionReason: string | null;
      bouncedAt: Date | null;
      firstContactedAt: Date | null;
      manualFollowupAt: Date | null;
      notes: string | null;
      presentInSource: boolean;
      rowKey: string;
      sheetState: string | null;
      campaignId: number;
      emailNorm: string | null;
      phoneNorm: string | null;
    }
  >(
    `select l.id, l.name, l.email_norm as email, l.email_norm as "emailNorm", l.phone, l.phone_norm as "phoneNorm", l.wa_chat_id as "waChatId",
            c.slug as "campaignSlug", c.name as "campaignName", c.id as "campaignId", c.channel, s.name as "sourceName", s.external_url as "sourceUrl",
            l.source_row_number as "rowNumber", l.source_row_key as "rowKey", l.status, l.sheet_status as "sheetStatus", l.sheet_state as "sheetState",
            l.sends_accepted as "sendsAccepted", l.followups_accepted as "followupsAccepted", l.last_contacted_at as "lastContactedAt",
            l.first_contacted_at as "firstContactedAt", l.last_reply_at as "lastReplyAt", l.reply_sentiment as "replySentiment",
            l.next_followup_at as "nextFollowupAt", l.manual_followup_at as "manualFollowupAt", l.website, l.city, l.country, l.category, l.raw,
            l.is_duplicate as "isDuplicate", l.duplicate_of as "duplicateOf", l.suppressed, l.suppression_reason as "suppressionReason",
            l.bounced_at as "bouncedAt", l.notes, l.present_in_source as "presentInSource"
       from leads l join campaigns c on c.id = l.campaign_id left join sources s on s.id = l.source_id where l.id = $1`,
    [id],
  );
  if (!lead) return null;
  const attempts = await q<{
    id: number;
    occurredAt: Date | null;
    timeQuality: string;
    step: number;
    result: string;
    provider: string | null;
    providerStatus: string | null;
    errorMessage: string | null;
    sender: string | null;
    source: string;
    messageId: string | null;
    executionId: string | null;
    subject: string | null;
    waAck: number | null;
  }>(
    `select id, occurred_at as "occurredAt", time_quality as "timeQuality", step, result, provider, provider_status as "providerStatus",
            error_message as "errorMessage", sender, source, message_id as "messageId", n8n_execution_id as "executionId", subject, wa_ack as "waAck"
       from send_attempts where lead_id = $1 or (lead_id is null and campaign_id = $2 and recipient_norm = coalesce($3, $4))
      order by occurred_at desc nulls last, id desc`,
    [id, lead.campaignId, lead.emailNorm, lead.waChatId],
  );
  const messages = await q<{
    id: number;
    threadKey: string | null;
    direction: string;
    kind: string;
    subject: string | null;
    fromAddr: string | null;
    sentAt: Date | null;
    folder: string;
    mailbox: string;
    sentiment: string | null;
  }>(
    `select m.id, m.thread_key as "threadKey", m.direction, m.kind, m.subject, m.from_addr as "fromAddr", m.sent_at as "sentAt", m.folder,
            mb.address as mailbox, m.sentiment
       from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
      where m.lead_id = $1 or ($2::text is not null and m.counterpart = $2)
      order by m.sent_at desc limit 100`,
    [id, lead.emailNorm],
  );
  const whatsapp = await q<{ id: number; fromMe: boolean; body: string | null; sentAt: Date; ack: number | null; session: string }>(
    `select id, from_me as "fromMe", body, sent_at as "sentAt", ack, session from wa_messages where lead_id = $1 or ($2::text is not null and chat_id = $2)
      order by sent_at desc limit 100`,
    [id, lead.waChatId],
  );
  const otherCampaigns = await q<{ id: number; campaignName: string; campaignSlug: string; status: string }>(
    `select l.id, c.name as "campaignName", c.slug as "campaignSlug", l.status from leads l join campaigns c on c.id = l.campaign_id
      where l.id <> $1 and ((l.email_norm is not null and l.email_norm = $2) or (l.wa_chat_id is not null and l.wa_chat_id = $3))
      order by l.id`,
    [id, lead.emailNorm, lead.waChatId],
  );
  return { lead, attempts, messages, whatsapp, otherCampaigns };
}

export async function statusSummary(): Promise<Record<string, number>> {
  const rows = await q<{ status: string; n: number }>(
    `select status, count(*)::int as n from leads where present_in_source or sends_accepted > 0 group by status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
