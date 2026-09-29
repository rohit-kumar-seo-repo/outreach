import { one, q } from '../db';
import { Params } from './filters';

export interface ThreadQuery {
  mailbox?: string | null;
  domain?: string | null;
  folder?: string | null;
  unread?: boolean;
  campaign?: string | null;
  lead?: number | null;
  match?: 'matched' | 'unmatched' | 'all';
  kind?: 'replies' | 'bounces' | 'all';
  flagged?: boolean;
  search?: string | null;
  page?: number;
}

export interface ThreadRow {
  threadKey: string;
  lastAt: Date | null;
  messages: number;
  unread: number;
  flagged: boolean;
  hasReply: boolean;
  hasBounce: boolean;
  subject: string | null;
  counterpart: string | null;
  fromName: string | null;
  mailbox: string;
  folder: string;
  direction: string;
  kind: string;
  leadId: number | null;
  leadName: string | null;
  campaignSlug: string | null;
  campaignName: string | null;
  matchMethod: string | null;
  suggestedLeadId: number | null;
}

export async function listThreads(opts: ThreadQuery): Promise<{ rows: ThreadRow[]; total: number }> {
  const p = new Params();
  const where: string[] = [];
  if (opts.mailbox) where.push(`mb.address = ${p.add(opts.mailbox)}`);
  if (opts.domain) where.push(`mb.domain = ${p.add(opts.domain)}`);
  if (opts.folder) where.push(`m.folder = ${p.add(opts.folder)}`);
  if (opts.search) {
    const s = p.add(`%${opts.search.toLowerCase()}%`);
    where.push(`(lower(coalesce(m.subject,'')) like ${s} or coalesce(m.counterpart,'') like ${s} or lower(coalesce(m.from_name,'')) like ${s})`);
  }
  const threadWhere: string[] = [];
  if (opts.unread) threadWhere.push('t.unread > 0');
  if (opts.flagged) threadWhere.push('t.flagged');
  if (opts.campaign) threadWhere.push(`c.slug = ${p.add(opts.campaign)}`);
  if (opts.lead) threadWhere.push(`t.lead_id = ${p.add(opts.lead)}`);
  if (opts.match === 'matched') threadWhere.push('t.lead_id is not null');
  if (opts.match === 'unmatched') threadWhere.push(`t.lead_id is null and t.has_inbound_message`);
  if (opts.kind === 'replies') threadWhere.push('t.has_reply');
  if (opts.kind === 'bounces') threadWhere.push('t.has_bounce');
  const page = Math.max(1, opts.page ?? 1);
  const cte = `with m as (
      select m.*, mb.address as mailbox from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
       ${where.length ? `where ${where.join(' and ')}` : ''}),
    t as (
      select m.thread_key, max(m.sent_at) as last_at, count(distinct coalesce(m.message_id, m.id::text))::int as n,
             count(distinct coalesce(m.message_id, m.id::text)) filter (where m.unseen and m.direction = 'inbound')::int as unread,
             bool_or(m.needs_followup) as flagged, bool_or(m.is_outreach_reply) as has_reply, bool_or(m.kind = 'bounce') as has_bounce,
             bool_or(m.direction = 'inbound' and m.kind = 'message') as has_inbound_message,
             (array_agg(m.lead_id order by m.sent_at desc) filter (where m.lead_id is not null))[1] as lead_id,
             (array_agg(m.campaign_id order by m.sent_at desc) filter (where m.campaign_id is not null))[1] as campaign_id
        from m group by m.thread_key)`;
  const total =
    (await one<{ n: number }>(`${cte} select count(*)::int as n from t left join campaigns c on c.id = t.campaign_id ${threadWhere.length ? `where ${threadWhere.join(' and ')}` : ''}`, p.values))?.n ?? 0;
  const rows = await q<ThreadRow>(
    `${cte}
     select t.thread_key as "threadKey", t.last_at as "lastAt", t.n as messages, t.unread, t.flagged, t.has_reply as "hasReply",
            t.has_bounce as "hasBounce", x.subject, x.counterpart, x.from_name as "fromName", x.mailbox, x.folder, x.direction, x.kind,
            t.lead_id as "leadId", l.name as "leadName", c.slug as "campaignSlug", c.name as "campaignName", x.match_method as "matchMethod",
            x.suggested_lead_id as "suggestedLeadId"
       from t
       join lateral (select * from m where m.thread_key = t.thread_key order by m.sent_at desc nulls last limit 1) x on true
       left join leads l on l.id = t.lead_id
       left join campaigns c on c.id = t.campaign_id
      ${threadWhere.length ? `where ${threadWhere.join(' and ')}` : ''}
      order by t.last_at desc nulls last
      limit 50 offset ${(page - 1) * 50}`,
    p.values,
  );
  return { rows, total };
}

export interface ThreadMessage {
  id: number;
  mailbox: string;
  folder: string;
  uid: number;
  messageId: string | null;
  direction: string;
  kind: string;
  fromAddr: string | null;
  fromName: string | null;
  toAddrs: string[];
  subject: string | null;
  sentAt: Date | null;
  unseen: boolean;
  hasAttachments: boolean;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyFetchedAt: Date | null;
  leadId: number | null;
  campaignId: number | null;
  matchMethod: string | null;
  matchConfidence: string | null;
  suggestedLeadId: number | null;
  sentiment: string | null;
  needsFollowup: boolean;
  followupDueAt: Date | null;
  followupNote: string | null;
  sendAttemptId: number | null;
  step: number | null;
}

export async function threadMessages(threadKey: string): Promise<ThreadMessage[]> {
  return q<ThreadMessage>(
    `select distinct on (coalesce(m.message_id, m.id::text))
            m.id, mb.address as mailbox, m.folder, m.uid, m.message_id as "messageId", m.direction, m.kind, m.from_addr as "fromAddr",
            m.from_name as "fromName", m.to_addrs as "toAddrs", m.subject, m.sent_at as "sentAt", m.unseen, m.has_attachments as "hasAttachments",
            m.body_text as "bodyText", m.body_html as "bodyHtml", m.body_fetched_at as "bodyFetchedAt", m.lead_id as "leadId",
            m.campaign_id as "campaignId", m.match_method as "matchMethod", m.match_confidence as "matchConfidence",
            m.suggested_lead_id as "suggestedLeadId", m.sentiment, m.needs_followup as "needsFollowup", m.followup_due_at as "followupDueAt",
            m.followup_note as "followupNote", m.send_attempt_id as "sendAttemptId", sa.step
       from mail_messages m join mailboxes mb on mb.id = m.mailbox_id left join send_attempts sa on sa.id = m.send_attempt_id
      where m.thread_key = $1
      order by coalesce(m.message_id, m.id::text), (m.folder ~* '^inbox$') desc, m.id`,
    [threadKey],
  ).then((rows) => rows.sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0)));
}

export async function folderOptions(mailbox: string | null): Promise<{ path: string; mailbox: string; messageCount: number | null; unreadCount: number | null }[]> {
  return q(
    `select f.path, mb.address as mailbox, f.message_count as "messageCount", f.unread_count as "unreadCount"
       from mail_folders f join mailboxes mb on mb.id = f.mailbox_id
      where $1::text is null or mb.address = $1
      order by mb.address, (f.special_use = '\\Inbox' or f.path ~* '^inbox$') desc, f.path`,
    [mailbox],
  );
}

export async function leadSearch(term: string): Promise<{ id: number; name: string | null; email: string | null; campaignName: string }[]> {
  if (!term.trim()) return [];
  const t = `%${term.trim().toLowerCase()}%`;
  return q(
    `select l.id, l.name, l.email_norm as email, c.name as "campaignName" from leads l join campaigns c on c.id = l.campaign_id
      where lower(coalesce(l.name,'')) like $1 or coalesce(l.email_norm,'') like $1 or l.source_row_key ilike $1
      order by l.sends_accepted desc, l.id limit 20`,
    [t],
  );
}
