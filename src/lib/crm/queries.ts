// Read side of the lead workspace (pipeline, Today, call queue, lead timeline).
import { one, q } from '../db';
import { env } from '../env';
import { Params } from '../metrics/filters';
import { registry } from '../registry';
import { addDays, localDate } from '../time';
import { contactLinks, type ContactLinks } from './contact';
import { OPEN_STAGES, STAGE_SQL, type Stage, isStage } from './stages';

export interface LeadCard {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  waChatId: string | null;
  city: string | null;
  category: string | null;
  campaignSlug: string;
  campaignName: string;
  channel: 'email' | 'whatsapp';
  sourceKey: string | null;
  stage: Stage | null;
  starred: boolean;
  reminderAt: Date | null;
  lastReplyAt: Date | null;
  lastContactedAt: Date | null;
  lastActivityAt: Date | null;
  lastCallAt: Date | null;
  lastCallOutcome: string | null;
  callCount: number;
  dealValue: number | null;
  dealCurrency: string | null;
  replyChannel: 'email' | 'whatsapp' | null;
  replyText: string | null;
  replyIntent: string | null;
  links: ContactLinks;
}

type CardRow = Omit<LeadCard, 'links' | 'replyText'> & { phoneNorm: string | null; replyText: string | null };

const CARD_COLS = `l.id, l.name, l.email_norm as email, l.phone, l.phone_norm as "phoneNorm", l.wa_chat_id as "waChatId", l.city, l.category,
  c.slug as "campaignSlug", c.name as "campaignName", c.channel, s.key as "sourceKey",
  ${STAGE_SQL} as stage, l.starred, l.manual_followup_at as "reminderAt", l.last_reply_at as "lastReplyAt",
  l.last_contacted_at as "lastContactedAt", l.last_activity_at as "lastActivityAt", l.last_call_at as "lastCallAt",
  l.last_call_outcome as "lastCallOutcome", l.call_count as "callCount", l.deal_value::float8 as "dealValue", l.deal_currency as "dealCurrency",
  r.ch as "replyChannel", r.body as "replyText", l.reply_intent as "replyIntent"`;

// Their latest reply on either channel (email body is cleaned in TS; it may still hold quoted history).
const REPLY_JOIN = `left join lateral (
    select * from (
      (select m.sent_at as at, 'email'::text as ch, left(coalesce(nullif(btrim(m.body_text), ''), m.subject), 1500) as body
         from mail_messages m where m.lead_id = l.id and m.is_outreach_reply order by m.sent_at desc nulls last limit 1)
      union all
      (select w.sent_at, 'whatsapp'::text, left(coalesce(w.body, case when w.has_media then '(media)' end), 1500)
         from wa_messages w where w.lead_id = l.id and not w.from_me and not w.is_auto order by w.sent_at desc limit 1)
    ) x order by at desc nulls last limit 1) r on true`;

const FROM = `from leads l join campaigns c on c.id = l.campaign_id left join sources s on s.id = l.source_id`;

function dialCodeFor(sourceKey: string | null): string | null {
  if (!sourceKey) return null;
  return registry().sources.find((s) => s.key === sourceKey)?.dialCode ?? null;
}

export function toCard(r: CardRow): LeadCard {
  const { phoneNorm, ...rest } = r;
  return {
    ...rest,
    stage: isStage(r.stage) ? r.stage : null,
    replyText: r.replyText ? replySnippet(r.replyText) : null,
    links: contactLinks({ phone: r.phone, phoneNorm, waChatId: r.waChatId, email: r.email, dialCode: dialCodeFor(r.sourceKey) }),
  };
}

/** The person's own words from a reply: drops quoted history, signatures separators and extra whitespace. */
export function replySnippet(text: string, max = 220): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^on .{3,200}wrote:?$/i.test(t) || /wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(original message|forwarded)/i.test(t) || /^_{5,}$/.test(t)) break;
    if (/^(from|sent|to|subject):\s/i.test(t) && out.length > 0) break;
    if (t === '--' || t === '-- ') break;
    out.push(t);
  }
  const s = out.join(' ').replace(/\s+/g, ' ').trim() || text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type PipelineView = 'open' | 'all' | 'contacts' | Stage;

export interface PipelineQuery {
  view: PipelineView;
  campaign?: string | null;
  channel?: 'email' | 'whatsapp' | null;
  search?: string | null;
  due?: boolean;
  starred?: boolean;
  /** Legacy filters from older links (/leads?status=…, ?followup=…, ?outcome=…). */
  status?: string | null;
  followup?: 'due' | 'today' | 'overdue' | null;
  outcome?: string | null;
  limit?: number;
  offset?: number;
}

function endOfTodaySql(p: Params): string {
  const tz = p.add(env.timezone);
  return `((((now() at time zone ${tz})::date + 1)::timestamp) at time zone ${tz})`;
}

function whereFor(opts: PipelineQuery, p: Params, withView = true): string[] {
  const where: string[] = [];
  if (withView) {
    if (opts.view === 'open') where.push(`${STAGE_SQL} = any(${p.add(OPEN_STAGES)})`);
    else if (opts.view === 'all') where.push(`${STAGE_SQL} is not null`);
    else if (opts.view === 'contacts') where.push('(l.present_in_source or l.sends_accepted > 0)');
    else where.push(`${STAGE_SQL} = ${p.add(opts.view)}`);
  }
  if (opts.view !== 'contacts' || !withView) where.push('(not l.is_duplicate or l.stage is not null)');
  if (opts.campaign) where.push(`c.slug = ${p.add(opts.campaign)}`);
  if (opts.channel) where.push(`c.channel = ${p.add(opts.channel)}`);
  if (opts.starred) where.push('l.starred');
  if (opts.due) where.push(`l.manual_followup_at < ${endOfTodaySql(p)}`);
  if (opts.status) where.push(`l.status = ${p.add(opts.status)}`);
  if (opts.outcome === 'any') where.push('l.outcome is not null');
  else if (opts.outcome) where.push(`l.outcome = ${p.add(opts.outcome)}`);
  if (opts.followup) {
    const tz = p.add(env.timezone);
    const today = `(now() at time zone ${tz})::date`;
    const due = `(l.next_followup_at at time zone ${tz})::date`;
    where.push(`l.next_followup_at is not null and l.status in ('followup_due','sent','queued')`);
    if (opts.followup === 'today') where.push(`${due} = ${today}`);
    else if (opts.followup === 'overdue') where.push(`${due} < ${today}`);
    else where.push(`${due} <= ${today}`);
  }
  if (opts.search?.trim()) {
    const s = p.add(`%${opts.search.trim().toLowerCase()}%`);
    const d = opts.search.replace(/\D/g, '');
    const digitMatch = d.length >= 4 ? ` or coalesce(l.phone_norm,'') like ${p.add(`%${d}%`)} or coalesce(l.wa_chat_id,'') like ${p.add(`%${d}%`)}` : '';
    where.push(
      `(lower(coalesce(l.name,'')) like ${s} or coalesce(l.email_norm,'') like ${s} or lower(coalesce(l.city,'')) like ${s} or lower(coalesce(l.category,'')) like ${s}${digitMatch})`,
    );
  }
  return where;
}

export async function listPipeline(opts: PipelineQuery): Promise<{ rows: LeadCard[]; total: number }> {
  const p = new Params();
  const where = whereFor(opts, p);
  const w = where.length ? `where ${where.map((x) => `(${x})`).join(' and ')}` : '';
  const total = (await one<{ n: number }>(`select count(*)::int as n ${FROM} ${w}`, p.values))?.n ?? 0;
  const order = opts.due
    ? 'l.manual_followup_at asc'
    : opts.followup
      ? 'l.next_followup_at asc'
      : opts.view === 'contacts'
        ? 'coalesce(l.last_reply_at, l.last_contacted_at, l.updated_at) desc nulls last, l.id desc'
        : 'l.starred desc, greatest(l.last_reply_at, l.last_activity_at, l.stage_changed_at) desc nulls last, l.id desc';
  const limit = Math.min(opts.limit ?? 60, 300);
  const rows = await q<CardRow>(
    `select ${CARD_COLS} ${FROM} ${REPLY_JOIN} ${w} order by ${order} limit ${limit} offset ${Math.max(0, opts.offset ?? 0)}`,
    p.values,
  );
  return { rows: rows.map(toCard), total };
}

/** Count per pipeline stage for the same filters (campaign, channel, search, starred, due). */
export async function stageCounts(opts: Omit<PipelineQuery, 'view'>): Promise<Record<Stage, number> & { contacts: number }> {
  const p = new Params();
  const where = whereFor({ ...opts, view: 'all' }, p, false);
  const w = where.length ? `where ${where.map((x) => `(${x})`).join(' and ')}` : '';
  const rows = await q<{ st: string | null; n: number }>(
    `select ${STAGE_SQL} as st, count(*)::int as n ${FROM} ${w} group by 1`,
    p.values,
  );
  const out = { new: 0, contacted: 0, interested: 0, meeting: 0, proposal: 0, won: 0, lost: 0, contacts: 0 };
  for (const r of rows) {
    if (r.st && isStage(r.st)) out[r.st] += r.n;
  }
  const p2 = new Params();
  const where2 = whereFor({ ...opts, view: 'contacts' }, p2);
  out.contacts = (await one<{ n: number }>(`select count(*)::int as n ${FROM} where ${where2.map((x) => `(${x})`).join(' and ')}`, p2.values))?.n ?? 0;
  return out;
}

export interface TodayData {
  today: string;
  reminders: LeadCard[];
  remindersTotal: number;
  newReplies: LeadCard[];
  newRepliesTotal: number;
  inPlay: LeadCard[];
  counts: Record<Stage, number>;
  callsToday: number;
  wonThisMonth: { n: number; value: number | null; currency: string | null };
  callQueue: number;
  lastSyncAt: Date | null;
  openAlerts: number;
}

export async function todayData(): Promise<TodayData> {
  const [reminders, newReplies, inPlay, counts, misc, queue] = await Promise.all([
    listPipeline({ view: 'contacts', due: true, limit: 25 }),
    listPipeline({ view: 'new', limit: 6 }),
    listPipeline({ view: 'open', limit: 40 }),
    stageCounts({}),
    one<{ calls: number; won: number; won_value: number | null; currency: string | null; last_sync: Date | null; alerts: number }>(
      `select (select count(*)::int from lead_activities where kind = 'call' and (occurred_at at time zone $1)::date = (now() at time zone $1)::date) as calls,
              (select count(*)::int from leads where stage = 'won' and date_trunc('month', stage_changed_at at time zone $1) = date_trunc('month', now() at time zone $1)) as won,
              (select sum(deal_value)::float8 from leads where stage = 'won' and date_trunc('month', stage_changed_at at time zone $1) = date_trunc('month', now() at time zone $1)) as won_value,
              (select mode() within group (order by deal_currency) from leads where stage = 'won' and deal_currency is not null) as currency,
              (select max(last_success_at) from sources) as last_sync,
              (select count(*)::int from alerts where resolved_at is null and acknowledged_at is null) as alerts`,
      [env.timezone],
    ),
    callQueueIds(),
  ]);
  const shown = new Set([...reminders.rows, ...newReplies.rows].map((r) => r.id));
  return {
    today: localDate(),
    reminders: reminders.rows,
    remindersTotal: reminders.total,
    newReplies: newReplies.rows,
    newRepliesTotal: newReplies.total,
    inPlay: inPlay.rows.filter((r) => !shown.has(r.id) && r.stage !== 'new').slice(0, 8),
    counts,
    callsToday: misc?.calls ?? 0,
    wonThisMonth: { n: misc?.won ?? 0, value: misc?.won_value ?? null, currency: misc?.currency ?? null },
    callQueue: queue.length,
    lastSyncAt: misc?.last_sync ?? null,
    openAlerts: misc?.alerts ?? 0,
  };
}

/**
 * Who to call next, in order: reminders that are due, then fresh replies (newest first), then
 * interested / in-progress leads not called in the last 3 days. Leads with no usable number, a
 * wrong-number call, or a call in the last 2 hours (unless a reminder is due) are skipped.
 */
export async function callQueueIds(): Promise<number[]> {
  const rows = await q<{ id: number }>(
    `select l.id from leads l
      where ${STAGE_SQL} = any($1)
        and (not l.is_duplicate or l.stage is not null)
        and (length(coalesce(l.phone_norm, '')) >= 6 or l.wa_chat_id like '%@c.us')
        and coalesce(l.last_call_outcome, '') <> 'wrong_number'
        and ((l.manual_followup_at <= now() and (l.last_call_at is null or l.last_call_at < l.manual_followup_at))
             or l.last_call_at is null or l.last_call_at < now() - interval '2 hours')
        and (l.manual_followup_at is null or l.manual_followup_at <= now())
      order by
        (l.manual_followup_at is not null) desc,
        l.manual_followup_at asc nulls last,
        (${STAGE_SQL} = 'new') desc,
        (l.last_call_at is null or l.last_call_at < now() - interval '3 days') desc,
        l.starred desc,
        l.last_reply_at desc nulls last,
        l.id
      limit 200`,
    [OPEN_STAGES],
  );
  return rows.map((r) => r.id);
}

export async function cardsByIds(ids: number[]): Promise<LeadCard[]> {
  if (ids.length === 0) return [];
  const rows = await q<CardRow>(`select ${CARD_COLS} ${FROM} ${REPLY_JOIN} where l.id = any($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
  return ids.map((id) => byId.get(id)).filter((x): x is LeadCard => !!x);
}

// ------------------------------------------------------------------ lead workspace ----

export interface TimelineItem {
  key: string;
  at: Date | null;
  kind: 'call' | 'note' | 'stage' | 'reminder' | 'sent' | 'send_failed' | 'reply' | 'our_reply' | 'wa_in' | 'wa_out';
  title: string;
  body: string | null;
  meta: string | null;
  href: string | null;
  outcome: string | null;
  activityId: number | null;
}

export interface LeadWorkspace {
  card: LeadCard;
  stageSource: string | null;
  stageChangedAt: Date | null;
  website: string | null;
  country: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  rowNumber: number | null;
  sheetStatus: string | null;
  status: string;
  suppressed: boolean;
  suppressionReason: string | null;
  presentInSource: boolean;
  sendsAccepted: number;
  followupsAccepted: number;
  firstContactedAt: Date | null;
  nextFollowupAt: Date | null;
  replySentiment: string | null;
  raw: Record<string, unknown>;
  sheetStageText: string | null;
  sheetReplyNote: string | null;
  sheetMeetingTime: string | null;
  latestThread: string | null;
  waChat: { chatId: string; session: string } | null;
  otherCampaigns: { id: number; campaignName: string; stage: string | null }[];
  timeline: TimelineItem[];
}

export async function leadWorkspace(id: number): Promise<LeadWorkspace | null> {
  const row = await one<
    CardRow & {
      stageSource: string | null;
      stageChangedAt: Date | null;
      website: string | null;
      country: string | null;
      sourceName: string | null;
      sourceUrl: string | null;
      rowNumber: number | null;
      sheetStatus: string | null;
      status: string;
      suppressed: boolean;
      suppressionReason: string | null;
      presentInSource: boolean;
      sendsAccepted: number;
      followupsAccepted: number;
      firstContactedAt: Date | null;
      nextFollowupAt: Date | null;
      replySentiment: string | null;
      raw: Record<string, unknown>;
      campaignId: number;
    }
  >(
    `select ${CARD_COLS}, l.stage_source as "stageSource", l.stage_changed_at as "stageChangedAt", l.website, l.country,
            s.name as "sourceName", s.external_url as "sourceUrl", l.source_row_number as "rowNumber", l.sheet_status as "sheetStatus",
            l.status, l.suppressed, l.suppression_reason as "suppressionReason", l.present_in_source as "presentInSource",
            l.sends_accepted as "sendsAccepted", l.followups_accepted as "followupsAccepted", l.first_contacted_at as "firstContactedAt",
            l.next_followup_at as "nextFollowupAt", l.reply_sentiment as "replySentiment", l.raw, c.id as "campaignId"
       ${FROM} ${REPLY_JOIN} where l.id = $1`,
    [id],
  );
  if (!row) return null;
  const src = registry().sources.find((s) => s.key === row.sourceKey);
  const rawStr = (col: string | undefined) => {
    if (!col) return null;
    const v = row.raw?.[col];
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s || null;
  };

  const [activities, sends, mails, was, others] = await Promise.all([
    q<{ id: number; kind: string; outcome: string | null; body: string | null; occurredAt: Date; createdBy: string | null }>(
      `select id, kind, outcome, body, occurred_at as "occurredAt", created_by as "createdBy" from lead_activities where lead_id = $1 order by occurred_at desc limit 200`,
      [id],
    ),
    q<{ id: number; occurredAt: Date | null; step: number; result: string; subject: string | null; sender: string | null; errorMessage: string | null; channel: string }>(
      `select id, occurred_at as "occurredAt", step, result, subject, sender, error_message as "errorMessage", channel
         from send_attempts where (lead_id = $1 or (lead_id is null and campaign_id = $2 and recipient_norm = coalesce($3, $4))) and not is_internal
        order by occurred_at desc nulls last limit 100`,
      [id, row.campaignId, row.email, row.waChatId],
    ),
    q<{ id: number; threadKey: string | null; direction: string; kind: string; subject: string | null; bodyText: string | null; sentAt: Date | null; isReply: boolean; sendAttemptId: number | null }>(
      `select m.id, m.thread_key as "threadKey", m.direction, m.kind, m.subject, left(m.body_text, 3000) as "bodyText", m.sent_at as "sentAt",
              m.is_outreach_reply as "isReply", m.send_attempt_id as "sendAttemptId"
         from mail_messages m
        where (m.lead_id = $1 or ($2::text is not null and m.counterpart = $2)) and m.kind in ('message', 'auto_reply')
        order by m.sent_at desc nulls last limit 100`,
      [id, row.email],
    ),
    q<{ id: number; fromMe: boolean; body: string | null; sentAt: Date; session: string; chatId: string; isAuto: boolean; hasMedia: boolean }>(
      `select id, from_me as "fromMe", body, sent_at as "sentAt", session, chat_id as "chatId", is_auto as "isAuto", has_media as "hasMedia"
         from wa_messages where lead_id = $1 or ($2::text is not null and chat_id = $2) order by sent_at desc limit 150`,
      [id, row.waChatId],
    ),
    q<{ id: number; campaignName: string; stage: string | null }>(
      `select l.id, c.name as "campaignName", ${STAGE_SQL} as stage from leads l join campaigns c on c.id = l.campaign_id
        where l.id <> $1 and ((l.email_norm is not null and l.email_norm = $2) or (l.wa_chat_id is not null and l.wa_chat_id = $3)) order by l.id`,
      [id, row.email, row.waChatId],
    ),
  ]);

  const timeline: TimelineItem[] = [];
  for (const a of activities) {
    timeline.push({
      key: `a${a.id}`,
      at: a.occurredAt,
      kind: a.kind as TimelineItem['kind'],
      title: a.kind,
      body: a.body,
      meta: a.createdBy === 'migrated' ? 'Saved note' : null,
      href: null,
      outcome: a.outcome,
      activityId: a.id,
    });
  }
  const sendIds = new Set<number>();
  for (const s of sends) {
    sendIds.add(s.id);
    const step = s.step === 0 ? 'First message' : `Follow-up ${s.step}`;
    timeline.push({
      key: `s${s.id}`,
      at: s.occurredAt,
      kind: s.result === 'accepted' ? 'sent' : 'send_failed',
      title: `${step} ${s.result === 'accepted' ? 'sent' : 'failed'}${s.channel === 'whatsapp' ? ' on WhatsApp' : ''}`,
      body: s.result === 'accepted' ? s.subject : s.errorMessage,
      meta: s.sender,
      href: null,
      outcome: null,
      activityId: null,
    });
  }
  for (const m of mails) {
    if (m.direction === 'outbound' && m.sendAttemptId) continue; // already shown as a send
    const inbound = m.direction === 'inbound';
    if (inbound && !m.isReply) continue;
    timeline.push({
      key: `m${m.id}`,
      at: m.sentAt,
      kind: inbound ? 'reply' : 'our_reply',
      title: inbound ? (m.kind === 'auto_reply' ? 'Automatic reply' : 'Replied by email') : 'You replied by email',
      body: m.bodyText ? replySnippet(m.bodyText, 600) : m.subject,
      meta: m.subject,
      href: m.threadKey ? `/inbox?thread=${encodeURIComponent(m.threadKey)}` : null,
      outcome: null,
      activityId: null,
    });
  }
  for (const w of was) {
    if (w.fromMe && sends.some((s) => s.channel === 'whatsapp' && s.occurredAt && Math.abs(s.occurredAt.getTime() - w.sentAt.getTime()) < 120_000)) continue;
    timeline.push({
      key: `w${w.id}`,
      at: w.sentAt,
      kind: w.fromMe ? 'wa_out' : 'wa_in',
      title: w.fromMe ? 'WhatsApp sent' : w.isAuto ? 'WhatsApp auto-reply' : 'Replied on WhatsApp',
      body: w.body ?? (w.hasMedia ? '(media)' : null),
      meta: w.session,
      href: `/whatsapp/inbox?chat=${encodeURIComponent(w.chatId)}&session=${encodeURIComponent(w.session)}`,
      outcome: null,
      activityId: null,
    });
  }
  timeline.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  const latestThread = mails.find((m) => m.threadKey && m.direction === 'inbound' && m.isReply)?.threadKey ?? mails.find((m) => m.threadKey)?.threadKey ?? null;
  const latestWa = was.find((w) => !w.fromMe) ?? was[0] ?? null;
  return {
    card: toCard(row),
    stageSource: row.stageSource,
    stageChangedAt: row.stageChangedAt,
    website: row.website,
    country: row.country,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    rowNumber: row.rowNumber,
    sheetStatus: row.sheetStatus,
    status: row.status,
    suppressed: row.suppressed,
    suppressionReason: row.suppressionReason,
    presentInSource: row.presentInSource,
    sendsAccepted: row.sendsAccepted,
    followupsAccepted: row.followupsAccepted,
    firstContactedAt: row.firstContactedAt,
    nextFollowupAt: row.nextFollowupAt,
    replySentiment: row.replySentiment,
    raw: row.raw ?? {},
    sheetStageText: rawStr(src?.columns.pipelineStage),
    sheetReplyNote: rawStr(src?.columns.replyNote),
    sheetMeetingTime: rawStr(src?.columns.meetingTime),
    latestThread,
    waChat: latestWa ? { chatId: latestWa.chatId, session: latestWa.session } : null,
    otherCampaigns: others,
    timeline: timeline.slice(0, 150),
  };
}

/** Local YYYY-MM-DD for "tomorrow" etc., exported for the reminder picker's date input. */
export function reminderDateBounds(): { min: string; max: string } {
  const today = localDate();
  return { min: today, max: addDays(today, 365) };
}
