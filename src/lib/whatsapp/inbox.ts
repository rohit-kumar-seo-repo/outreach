// WhatsApp inbox: conversation list with filters/counts, and one conversation's full history.
// Mirrors the shape of src/lib/metrics/inbox.ts (the email inbox) but over wa_messages, which
// is much simpler (no folders, no bounce parsing) — a chat is just (session, chat_id).
import { q, one } from '../db';
import { Params } from '../metrics/filters';

export const WA_VIEWS = ['needs_reply', 'all', 'unread', 'auto_replies'] as const;
export type WaView = (typeof WA_VIEWS)[number];

export interface WaInboxFilters {
  view: WaView;
  session?: string | null;
  campaign?: string | null;
  from?: string | null; // local date, inclusive
  to?: string | null;
  search?: string | null;
}

const BASE_CTE = `
  with c as (
    select chat_id, session, max(sent_at) as last_at,
           max(sent_at) filter (where not from_me and not is_auto) as last_in_at,
           max(sent_at) filter (where from_me) as last_out_at,
           count(*) filter (where not from_me and not is_auto)::int as inbound,
           count(*) filter (where not from_me and is_auto)::int as auto_replies,
           count(*) filter (where from_me)::int as outbound,
           (array_agg(lead_id order by sent_at desc) filter (where lead_id is not null))[1] as lead_id,
           (array_agg(campaign_id order by sent_at desc) filter (where campaign_id is not null))[1] as campaign_id
      from wa_messages group by chat_id, session),
  ct as (
    select w.chat_id, w.phone, w.name from wa_contacts w),
  t as (
    select c.chat_id, c.session, c.last_at, c.last_in_at, c.last_out_at, c.inbound, c.auto_replies, c.outbound,
           c.lead_id, l.name as lead_name, ctc.name as contact_name, cp.slug as campaign_slug, cp.name as campaign_name,
           x.body as last_body, x.from_me as last_from_me, x.is_auto as last_is_auto,
           coalesce(case when c.chat_id like '%@c.us' then replace(c.chat_id, '@c.us', '') end, ctc.phone) as phone,
           (c.chat_id like '%@lid' and ctc.phone is null) as hidden_number,
           wt.handled_at, wt.needs_followup_at, wt.last_read_at,
           (c.last_in_at is not null and c.last_in_at > coalesce(c.last_out_at, '-infinity') and c.last_in_at > coalesce(wt.handled_at, '-infinity')) as needs_reply,
           (c.last_in_at is not null and c.last_in_at > coalesce(wt.last_read_at, '-infinity')) as unread
      from c
      left join lateral (select body, from_me, is_auto from wa_messages w where w.chat_id = c.chat_id and w.session = c.session order by sent_at desc limit 1) x on true
      left join ct ctc on ctc.chat_id = c.chat_id
      left join leads l on l.id = c.lead_id
      left join campaigns cp on cp.id = c.campaign_id
      left join wa_threads wt on wt.session = c.session and wt.chat_id = c.chat_id)`;

function viewSql(view: WaView): string {
  if (view === 'needs_reply') return 'and t.needs_reply';
  if (view === 'unread') return 'and t.unread';
  if (view === 'auto_replies') return 'and t.auto_replies > 0';
  return '';
}

function filterSql(f: WaInboxFilters, p: Params): string {
  const parts: string[] = [viewSql(f.view)];
  if (f.session) parts.push(`and t.session = ${p.add(f.session)}`);
  if (f.campaign) parts.push(`and t.campaign_slug = ${p.add(f.campaign)}`);
  if (f.from) parts.push(`and t.last_at >= ${p.add(f.from)}::date`);
  if (f.to) parts.push(`and t.last_at < (${p.add(f.to)}::date + 1)`);
  if (f.search) parts.push(`and (coalesce(t.lead_name,'') || ' ' || coalesce(t.contact_name,'') || ' ' || coalesce(t.phone,'') || ' ' || coalesce(t.last_body,'')) ilike ${p.add(`%${f.search}%`)}`);
  return parts.join(' ');
}

export interface WaThreadRow {
  chatId: string;
  session: string;
  lastAt: Date;
  phone: string | null;
  hiddenNumber: boolean;
  leadId: number | null;
  leadName: string | null;
  contactName: string | null;
  campaignSlug: string | null;
  campaignName: string | null;
  lastBody: string | null;
  lastFromMe: boolean;
  lastIsAuto: boolean;
  inbound: number;
  autoReplies: number;
  outbound: number;
  needsReply: boolean;
  unread: boolean;
  handledAt: Date | null;
  needsFollowupAt: Date | null;
}

const ROW_COLS = `t.chat_id as "chatId", t.session, t.last_at as "lastAt", t.phone, t.hidden_number as "hiddenNumber",
  t.lead_id as "leadId", t.lead_name as "leadName", t.contact_name as "contactName", t.campaign_slug as "campaignSlug", t.campaign_name as "campaignName",
  t.last_body as "lastBody", t.last_from_me as "lastFromMe", t.last_is_auto as "lastIsAuto",
  t.inbound, t.auto_replies as "autoReplies", t.outbound, t.needs_reply as "needsReply", t.unread,
  t.handled_at as "handledAt", t.needs_followup_at as "needsFollowupAt"`;

export async function listWaThreads(f: WaInboxFilters, limit = 60): Promise<WaThreadRow[]> {
  const p = new Params();
  const where = filterSql(f, p);
  return q<WaThreadRow>(`${BASE_CTE} select ${ROW_COLS} from t where true ${where} order by t.needs_reply desc, t.last_at desc limit ${p.add(limit)}`, p.values);
}

export async function waInboxCounts(base: Omit<WaInboxFilters, 'view'>): Promise<Record<WaView, number>> {
  const out = {} as Record<WaView, number>;
  await Promise.all(
    WA_VIEWS.map(async (view) => {
      const p = new Params();
      const where = filterSql({ ...base, view }, p);
      const row = await one<{ n: number }>(`${BASE_CTE} select count(*)::int as n from t where true ${where}`, p.values);
      out[view] = row?.n ?? 0;
    }),
  );
  return out;
}

export async function needsReplyCount(): Promise<number> {
  const row = await one<{ n: number }>(`${BASE_CTE} select count(*)::int as n from t where t.needs_reply`);
  return row?.n ?? 0;
}

export interface WaMessageRow {
  id: number;
  fromMe: boolean;
  body: string | null;
  sentAt: Date;
  ack: number | null;
  session: string;
  hasMedia: boolean;
  isAuto: boolean;
  sentiment: string | null;
  autoOverride: boolean;
}

export async function waThreadMessages(session: string, chatId: string): Promise<WaMessageRow[]> {
  return q<WaMessageRow>(
    `select id, from_me as "fromMe", body, sent_at as "sentAt", ack, session, has_media as "hasMedia", is_auto as "isAuto",
            sentiment, auto_override as "autoOverride"
       from wa_messages where session = $1 and chat_id = $2 order by sent_at`,
    [session, chatId],
  );
}

export interface WaThreadContext {
  chatId: string;
  session: string;
  phone: string | null;
  hiddenNumber: boolean;
  leadId: number | null;
  leadName: string | null;
  contactName: string | null;
  campaignSlug: string | null;
  campaignName: string | null;
  city: string | null;
  category: string | null;
  leadStatus: string | null;
  handledAt: Date | null;
  needsFollowupAt: Date | null;
  sessionStatus: string | null;
}

export async function waThreadContext(session: string, chatId: string): Promise<WaThreadContext | null> {
  return one<WaThreadContext>(
    `select $1::text as "chatId", $2::text as session,
            coalesce(case when $1 like '%@c.us' then replace($1, '@c.us', '') end, ct.phone) as phone,
            ($1 like '%@lid' and ct.phone is null) as "hiddenNumber",
            l.id as "leadId", l.name as "leadName", ct.name as "contactName", cp.slug as "campaignSlug", cp.name as "campaignName",
            l.city, l.category, l.status as "leadStatus",
            wt.handled_at as "handledAt", wt.needs_followup_at as "needsFollowupAt", ws.status as "sessionStatus"
       from (select 1) x
       left join wa_contacts ct on ct.chat_id = $1
       left join wa_sessions ws on ws.name = $2
       left join wa_threads wt on wt.session = $2 and wt.chat_id = $1
       left join lateral (
         select lead_id from wa_messages where session = $2 and chat_id = $1 and lead_id is not null order by sent_at desc limit 1) m on true
       left join leads l on l.id = m.lead_id
       left join campaigns cp on cp.id = l.campaign_id`,
    [chatId, session],
  );
}
