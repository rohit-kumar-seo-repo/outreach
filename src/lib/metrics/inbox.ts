// Inbox: conversations (threads) across every synced mailbox, with triage views.
//
// "Needs reply" = the latest human message in the conversation came from them (not a bounce,
// auto-reply or internal/automation mail, not spam), it is an outreach conversation (matched to
// a lead, a reply to mail we sent, or a likely match), you have not answered it since (in webmail
// or from the dashboard), you did not mark it "no reply needed", it is not snoozed, and you did not
// mark the conversation as not outreach.
import { one, q } from '../db';
import { registry } from '../registry';
import { Params } from './filters';

export const INBOX_VIEWS = ['needs_reply', 'inbox', 'sent', 'snoozed', 'bounces', 'spam', 'unmatched', 'internal', 'all'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export const MESSAGE_TYPES = ['lead_reply', 'human', 'auto_reply', 'bounce', 'internal'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface InboxScope {
  domain?: string | null;
  mailbox?: string | null;
}

export interface InboxQuery extends InboxScope {
  view: InboxView;
  campaign?: string | null;
  unread?: boolean;
  needsReply?: boolean;
  match?: 'matched' | 'unmatched' | null;
  type?: MessageType | null;
  search?: string | null;
  sort?: 'newest' | 'oldest';
  page?: number;
}

export const PAGE_SIZE = 40;

/** Adds the scope parameters once; returns a renderer so several aliases can reuse the same placeholders. */
function scopePlaceholders(p: Params, scope: InboxScope): (alias: string) => string[] {
  const mailbox = scope.mailbox ? p.add(scope.mailbox) : null;
  const domain = scope.domain ? p.add(scope.domain) : null;
  return (alias) => [...(mailbox ? [`${alias}.address = ${mailbox}`] : []), ...(domain ? [`${alias}.domain = ${domain}`] : [])];
}

/** Per-thread aggregates within the domain/mailbox scope, plus triage state. Defines CTEs m, t, v. */
function threadsCte(scopeSql: (alias: string) => string[]): string {
  const where = ['m.thread_key is not null', ...scopeSql('mb')];
  return `
  m as (
    select m.thread_key, m.folder, m.direction, m.kind, m.sent_at, m.lead_id, m.campaign_id, m.suggested_lead_id, m.match_method,
           m.needs_followup, m.send_attempt_id, coalesce(m.message_id, m.id::text) as mkey,
           (m.folder ~* '(^|[./])(spam|junk)') as in_spam,
           (m.folder ~* '(^|[./])(trash|deleted)') as in_trash,
           (m.direction = 'inbound' and coalesce(not m.read_override, m.unseen)) as is_unread
      from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
     where ${where.join(' and ')}),
  t as (
    select thread_key,
           max(sent_at) filter (where not in_trash) as last_at,
           max(sent_at) filter (where direction = 'inbound' and not in_trash and not in_spam) as last_in,
           max(sent_at) filter (where direction = 'inbound' and kind = 'message' and not in_trash and not in_spam) as last_human_in,
           max(sent_at) filter (where direction = 'outbound' and send_attempt_id is null) as last_manual_out,
           max(sent_at) filter (where direction = 'outbound') as last_out,
           count(distinct mkey)::int as messages,
           count(distinct mkey) filter (where is_unread and not in_trash)::int as unread,
           coalesce(bool_or(direction = 'inbound' and not in_spam and not in_trash), false) as in_inbox,
           coalesce(bool_or(direction = 'outbound'), false) as has_sent,
           coalesce(bool_or(in_spam), false) as has_spam,
           coalesce(bool_or(kind = 'bounce'), false) as has_bounce,
           coalesce(bool_or(kind = 'internal'), false) as has_internal,
           coalesce(bool_or(kind = 'auto_reply'), false) as has_auto,
           coalesce(bool_or(direction = 'inbound' and kind = 'message' and not in_spam), false) as has_human_in,
           coalesce(bool_or(direction = 'inbound' and kind = 'message' and lead_id is not null), false) as has_lead_reply,
           coalesce(bool_or(match_method = 'manual_none'), false) as not_outreach,
           coalesce(bool_or(needs_followup), false) as flagged,
           (array_agg(lead_id order by sent_at desc nulls last) filter (where lead_id is not null))[1] as lead_id,
           (array_agg(campaign_id order by sent_at desc nulls last) filter (where campaign_id is not null))[1] as campaign_id,
           (array_agg(suggested_lead_id order by sent_at desc nulls last) filter (where suggested_lead_id is not null))[1] as suggested_lead_id
      from m group by thread_key),
  v as (
    select t.*, s.snoozed_until, s.snoozed_at, s.handled_at, r.at as dash_reply_at,
           coalesce(s.snoozed_until > now() and (s.snoozed_at is null or t.last_in is null or t.last_in <= s.snoozed_at), false) as snoozed,
           (t.last_human_in is not null and not t.not_outreach
             and (t.lead_id is not null or t.has_sent or t.suggested_lead_id is not null)
             and t.last_human_in > coalesce(greatest(t.last_manual_out, r.at), '-infinity'::timestamptz)
             and t.last_human_in > coalesce(s.handled_at, '-infinity'::timestamptz)) as awaiting,
           (t.has_human_in and t.lead_id is null and not t.not_outreach) as unmatched
      from t
      left join inbox_threads s on s.thread_key = t.thread_key
      left join (select thread_key, max(coalesce(sent_at, created_at)) as at from mail_replies
                  where status in ('sent', 'sending', 'unknown') group by thread_key) r on r.thread_key = t.thread_key)`;
}

const VIEW_WHERE: Record<InboxView, string> = {
  needs_reply: 'v.awaiting and not v.snoozed',
  inbox: 'v.in_inbox and not v.snoozed',
  sent: 'v.has_sent',
  snoozed: 'v.snoozed',
  bounces: 'v.has_bounce',
  spam: 'v.has_spam',
  unmatched: 'v.unmatched and not v.has_spam',
  internal: 'v.has_internal',
  all: 'true',
};

const VIEW_TIME: Record<InboxView, string> = {
  needs_reply: 'v.last_human_in',
  inbox: 'v.last_in',
  sent: 'v.last_out',
  snoozed: 'v.last_at',
  bounces: 'v.last_at',
  spam: 'v.last_at',
  unmatched: 'v.last_in',
  internal: 'v.last_at',
  all: 'v.last_at',
};

const TYPE_WHERE: Record<MessageType, string> = {
  lead_reply: 'v.has_lead_reply',
  human: 'v.has_human_in',
  auto_reply: 'v.has_auto',
  bounce: 'v.has_bounce',
  internal: 'v.has_internal',
};

export interface InboxCounts {
  needsReply: number;
  inboxUnread: number;
  snoozed: number;
  bounces30d: number;
  spamUnread: number;
  unmatched30d: number;
  internalUnread: number;
}

export async function inboxCounts(scope: InboxScope): Promise<InboxCounts> {
  const p = new Params();
  const row = await one<InboxCounts>(
    `with ${threadsCte(scopePlaceholders(p, scope))}
     select count(*) filter (where awaiting and not snoozed)::int as "needsReply",
            count(*) filter (where in_inbox and not snoozed and unread > 0)::int as "inboxUnread",
            count(*) filter (where snoozed)::int as snoozed,
            count(*) filter (where has_bounce and last_at > now() - interval '30 days')::int as "bounces30d",
            count(*) filter (where has_spam and unread > 0)::int as "spamUnread",
            count(*) filter (where unmatched and not has_spam and last_at > now() - interval '30 days')::int as "unmatched30d",
            count(*) filter (where has_internal and unread > 0)::int as "internalUnread"
       from v`,
    p.values,
  );
  return row ?? { needsReply: 0, inboxUnread: 0, snoozed: 0, bounces30d: 0, spamUnread: 0, unmatched30d: 0, internalUnread: 0 };
}

/** For the sidebar badge: conversations waiting for your reply, across all mailboxes. */
export async function needsReplyCount(): Promise<number> {
  return (await inboxCounts({})).needsReply;
}

export interface ThreadRow {
  threadKey: string;
  lastAt: Date | null;
  messages: number;
  unread: number;
  flagged: boolean;
  awaiting: boolean;
  snoozed: boolean;
  snoozedUntil: Date | null;
  hasBounce: boolean;
  hasInternal: boolean;
  hasSpam: boolean;
  unmatched: boolean;
  leadId: number | null;
  leadName: string | null;
  leadStatus: string | null;
  campaignSlug: string | null;
  campaignName: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddr: string | null;
  counterpart: string | null;
  direction: string;
  kind: string;
  mailbox: string;
  domain: string;
  folder: string;
  snippet: string | null;
  bounceRecipients: string[] | null;
  bounceCampaign: string | null;
  lastHumanIn: Date | null;
}

export async function listThreads(opts: InboxQuery): Promise<{ rows: ThreadRow[]; total: number }> {
  const p = new Params();
  const scopeSql = scopePlaceholders(p, opts);
  const cte = threadsCte(scopeSql);
  const where: string[] = [VIEW_WHERE[opts.view]];
  if (opts.campaign) where.push(`c.slug = ${p.add(opts.campaign)}`);
  if (opts.unread) where.push('v.unread > 0');
  if (opts.needsReply) where.push('v.awaiting and not v.snoozed');
  if (opts.match === 'matched') where.push('v.lead_id is not null');
  if (opts.match === 'unmatched') where.push('v.unmatched');
  if (opts.type) where.push(TYPE_WHERE[opts.type]);
  if (opts.search?.trim()) {
    const s = p.add(`%${opts.search.trim().toLowerCase()}%`);
    where.push(`(exists (select 1 from mail_messages sm where sm.thread_key = v.thread_key
                   and (lower(coalesce(sm.subject, '')) like ${s} or coalesce(sm.counterpart, '') like ${s} or lower(coalesce(sm.from_name, '')) like ${s}
                        or lower(coalesce(sm.body_text, '')) like ${s}))
                 or lower(coalesce(l.name, '')) like ${s} or coalesce(l.email_norm, '') like ${s} or lower(coalesce(c.name, '')) like ${s})`);
  }
  const time = `coalesce(${VIEW_TIME[opts.view]}, v.last_at)`;
  const preferIn = ['needs_reply', 'inbox', 'unmatched', 'spam'].includes(opts.view);
  const preferOut = opts.view === 'sent';
  const lateralScope = scopeSql('xb');
  const base = `from v left join leads l on l.id = v.lead_id left join campaigns c on c.id = v.campaign_id where ${where.map((w) => `(${w})`).join(' and ')}`;
  const total = (await one<{ n: number }>(`with ${cte} select count(*)::int as n ${base}`, p.values))?.n ?? 0;
  const page = Math.max(1, opts.page ?? 1);
  const rows = await q<ThreadRow>(
    `with ${cte}
     select v.thread_key as "threadKey", ${time} as "lastAt", v.messages, v.unread, v.flagged, v.awaiting, v.snoozed, v.snoozed_until as "snoozedUntil",
            v.has_bounce as "hasBounce", v.has_internal as "hasInternal", v.has_spam as "hasSpam", v.unmatched, v.lead_id as "leadId",
            l.name as "leadName", l.status as "leadStatus", c.slug as "campaignSlug", c.name as "campaignName", v.last_human_in as "lastHumanIn",
            x.subject, x.from_name as "fromName", x.from_addr as "fromAddr", x.counterpart, x.direction, x.kind, x.mailbox, x.domain, x.folder,
            nullif(left(regexp_replace(coalesce(x.body_text, ''), '\\s+', ' ', 'g'), 200), '') as snippet,
            b.recipients as "bounceRecipients", bc.name as "bounceCampaign"
       ${base.replace('from v ', `from v join lateral (
            select xm.subject, xm.from_name, xm.from_addr, xm.counterpart, xm.direction, xm.kind, xb.address as mailbox, xb.domain, xm.folder, xm.body_text
              from mail_messages xm join mailboxes xb on xb.id = xm.mailbox_id
             where xm.thread_key = v.thread_key and xm.folder !~* '(^|[./])(trash|deleted)' ${lateralScope.map((w) => `and ${w}`).join(' ')}
             order by ${preferIn ? "(xm.direction = 'inbound' and xm.kind <> 'bounce') desc," : preferOut ? "(xm.direction = 'outbound') desc," : ''} xm.sent_at desc nulls last, xm.id desc
             limit 1) x on true
          left join lateral (
            select array_agg(distinct bo.recipient_norm) as recipients, (array_agg(bo.campaign_id) filter (where bo.campaign_id is not null))[1] as campaign_id
              from bounces bo join mail_messages bm on bm.id = bo.mail_message_id where bm.thread_key = v.thread_key) b on v.has_bounce
          left join campaigns bc on bc.id = b.campaign_id `)}
      order by ${time} ${opts.sort === 'oldest' ? 'asc' : 'desc'} nulls last, v.thread_key
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
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
  ccAddrs: string[];
  subject: string | null;
  sentAt: Date | null;
  unseen: boolean;
  unread: boolean;
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
  sendAttemptId: number | null;
  step: number | null;
  provider: string;
}

export async function threadMessages(threadKey: string): Promise<ThreadMessage[]> {
  return q<ThreadMessage>(
    `select distinct on (coalesce(m.message_id, m.id::text))
            m.id, mb.address as mailbox, m.folder, m.uid, m.message_id as "messageId", m.direction, m.kind, m.from_addr as "fromAddr",
            m.from_name as "fromName", m.to_addrs as "toAddrs", m.cc_addrs as "ccAddrs", m.subject, m.sent_at as "sentAt", m.unseen,
            (m.direction = 'inbound' and coalesce(not m.read_override, m.unseen)) as unread, m.has_attachments as "hasAttachments",
            m.body_text as "bodyText", m.body_html as "bodyHtml", m.body_fetched_at as "bodyFetchedAt", m.lead_id as "leadId",
            m.campaign_id as "campaignId", m.match_method as "matchMethod", m.match_confidence as "matchConfidence",
            m.suggested_lead_id as "suggestedLeadId", m.sentiment, m.needs_followup as "needsFollowup", m.followup_due_at as "followupDueAt",
            m.send_attempt_id as "sendAttemptId", sa.step, mb.provider
       from mail_messages m join mailboxes mb on mb.id = m.mailbox_id left join send_attempts sa on sa.id = m.send_attempt_id
      where m.thread_key = $1
      order by coalesce(m.message_id, m.id::text), (m.folder ~* '^inbox$') desc, m.id`,
    [threadKey],
  ).then((rows) => rows.sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0)));
}

export interface PendingReply {
  id: number;
  fromAddr: string;
  toAddrs: string[];
  ccAddrs: string[];
  bodyText: string;
  status: string;
  providerStatus: string | null;
  errorMessage: string | null;
  createdAt: Date;
  sentAt: Date | null;
  createdBy: string;
}

/** Dashboard replies whose Sent-folder copy has not been synced yet (and failed attempts). */
export async function pendingReplies(threadKey: string): Promise<PendingReply[]> {
  return q<PendingReply>(
    `select id, from_addr as "fromAddr", to_addrs as "toAddrs", cc_addrs as "ccAddrs", body_text as "bodyText", status,
            provider_status as "providerStatus", error_message as "errorMessage", created_at as "createdAt", sent_at as "sentAt", created_by as "createdBy"
       from mail_replies where thread_key = $1 and mail_message_id is null and created_at > now() - interval '30 days'
      order by created_at`,
    [threadKey],
  );
}

export interface LeadContext {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
  status: string;
  outcome: string | null;
  replySentiment: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
  sendsAccepted: number;
  followupsAccepted: number;
  lastStep: number | null;
  firstContactedAt: Date | null;
  lastContactedAt: Date | null;
  lastReplyAt: Date | null;
  lastResponseAt: Date | null;
  nextFollowupAt: Date | null;
  campaignName: string;
  campaignSlug: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sentFrom: string | null;
  maxSteps: number | null;
}

export async function leadContext(leadId: number): Promise<LeadContext | null> {
  const row = await one<Omit<LeadContext, 'maxSteps'>>(
    `select l.id, l.name, l.email_norm as email, l.phone, l.website, l.city, l.country, l.category, l.status, l.outcome,
            l.reply_sentiment as "replySentiment", l.suppressed, l.suppression_reason as "suppressionReason",
            l.sends_accepted as "sendsAccepted", l.followups_accepted as "followupsAccepted", l.last_step as "lastStep",
            l.first_contacted_at as "firstContactedAt", l.last_contacted_at as "lastContactedAt", l.last_reply_at as "lastReplyAt",
            l.last_response_at as "lastResponseAt", l.next_followup_at as "nextFollowupAt",
            c.name as "campaignName", c.slug as "campaignSlug", s.name as "sourceName", s.external_url as "sourceUrl",
            (select sa.sender from send_attempts sa where sa.lead_id = l.id and sa.result = 'accepted' and sa.sender is not null
              order by sa.occurred_at desc nulls last, sa.id desc limit 1) as "sentFrom"
       from leads l join campaigns c on c.id = l.campaign_id left join sources s on s.id = l.source_id where l.id = $1`,
    [leadId],
  );
  if (!row) return null;
  const camp = registry().campaigns.find((c) => c.slug === row.campaignSlug);
  return { ...row, maxSteps: camp?.followup.maxSteps ?? null };
}

export interface BounceDetail {
  recipient: string;
  bounceType: string;
  statusCode: string | null;
  diagnostic: string | null;
  occurredAt: Date;
  leadId: number | null;
  leadName: string | null;
  campaignName: string | null;
  campaignSlug: string | null;
  sentFrom: string | null;
}

export async function threadBounces(threadKey: string): Promise<BounceDetail[]> {
  return q<BounceDetail>(
    `select distinct on (b.recipient_norm) b.recipient_norm as recipient, b.bounce_type as "bounceType", b.status_code as "statusCode",
            b.diagnostic, b.occurred_at as "occurredAt", b.lead_id as "leadId", l.name as "leadName", c.name as "campaignName",
            c.slug as "campaignSlug", sa.sender as "sentFrom"
       from bounces b join mail_messages m on m.id = b.mail_message_id
       left join leads l on l.id = b.lead_id left join campaigns c on c.id = b.campaign_id left join send_attempts sa on sa.id = b.send_attempt_id
      where m.thread_key = $1 order by b.recipient_norm, b.occurred_at desc`,
    [threadKey],
  );
}

export async function threadState(threadKey: string): Promise<{ snoozedUntil: Date | null; snoozedAt: Date | null; handledAt: Date | null } | null> {
  return one(`select snoozed_until as "snoozedUntil", snoozed_at as "snoozedAt", handled_at as "handledAt" from inbox_threads where thread_key = $1`, [threadKey]);
}

export interface MailboxHealth {
  address: string;
  domain: string;
  provider: string;
  lastStatus: string | null;
  lastError: string | null;
  lastSuccessAt: Date | null;
  canSend: boolean;
}

export async function mailboxHealth(): Promise<MailboxHealth[]> {
  return q<MailboxHealth>(
    `select address, domain, provider, last_status as "lastStatus", last_error as "lastError", last_success_at as "lastSuccessAt",
            (provider = 'hostinger_api' and last_status = 'ok') as "canSend"
       from mailboxes where sync_enabled order by domain, address`,
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
